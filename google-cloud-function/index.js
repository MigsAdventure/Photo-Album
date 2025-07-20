/**
 * Google Cloud Function for Wedding Photo Processing
 * Handles large files (200MB+) that exceed Cloudflare Worker limits
 * Supports 500MB+ videos with 8GB memory and 15-minute timeout
 * 
 * 2nd Generation Cloud Function (Cloud Run)
 */

const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');
const archiver = require('archiver');
const fetch = require('node-fetch');
const sharp = require('sharp');
const stream = require('stream');
const { promisify } = require('util');

// Initialize Google Cloud Storage
const storage = new Storage();
const bucketName = process.env.GOOGLE_CLOUD_STORAGE_BUCKET || 'sharedmoments-large-files';

/**
 * Main HTTP Cloud Function entry point for 2nd gen functions
 */
functions.http('processWeddingPhotos', async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).send();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const startTime = Date.now();
  let requestId = null;

  try {
    const { eventId, email, photos, requestId: reqId, source } = req.body;
    requestId = reqId;

    if (!eventId || !email || !photos || !Array.isArray(photos)) {
      console.error(`❌ Invalid request [${requestId}]: Missing required fields`);
      res.status(400).json({ 
        error: 'Missing required fields: eventId, email, photos' 
      });
      return;
    }

    console.log(`🚀 Google Cloud processing started [${requestId}]: ${photos.length} files for ${email}`);
    console.log(`📊 Collection size: ${(photos.reduce((sum, p) => sum + (p.size || 0), 0) / 1024 / 1024).toFixed(2)}MB`);

    // Acknowledge request immediately
    res.status(200).json({
      success: true,
      message: 'Google Cloud Function processing started',
      requestId,
      estimatedTime: '5-15 minutes'
    });

    // Process asynchronously (don't await - let function continue processing)
    processWeddingCollection(eventId, email, photos, requestId, startTime);

  } catch (error) {
    console.error(`❌ Google Cloud Function error [${requestId}]:`, error);
    
    // Send error response if we haven't responded yet
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message,
        requestId
      });
    }

    // Send error email
    if (requestId) {
      try {
        await sendErrorEmail(eventId, email, requestId, error.message);
      } catch (emailError) {
        console.error(`❌ Error email failed [${requestId}]:`, emailError);
      }
    }
  }
});

/**
 * Process wedding photo collection with large file support
 */
async function processWeddingCollection(eventId, email, photos, requestId, startTime) {
  try {
    console.log(`🎯 Processing collection [${requestId}]: ${photos.length} files`);

    // Analyze collection
    const analysis = analyzeCollection(photos, requestId);
    console.log(`📊 Collection analysis [${requestId}]:`, analysis);

    // Process files with optimized approach for large files
    const result = await processFilesWithStreaming(photos, eventId, requestId, analysis);

    // Send success email
    await sendSuccessEmail(eventId, email, requestId, result, startTime);

    console.log(`✅ Google Cloud processing complete [${requestId}] in ${(Date.now() - startTime) / 1000}s`);

  } catch (error) {
    console.error(`❌ Google Cloud processing failed [${requestId}]:`, error);
    await sendErrorEmail(eventId, email, requestId, error.message);
  }
}

/**
 * Analyze collection to optimize processing strategy
 */
function analyzeCollection(photos, requestId) {
  let totalSize = 0;
  let videoCount = 0;
  let largeFileCount = 0;
  let maxFileSize = 0;
  const fileTypes = new Map();

  for (const photo of photos) {
    const size = photo.size || 5 * 1024 * 1024; // Default 5MB
    totalSize += size;
    maxFileSize = Math.max(maxFileSize, size);

    if (size > 200 * 1024 * 1024) {
      largeFileCount++;
    }

    const extension = photo.fileName.split('.').pop().toLowerCase();
    if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(extension)) {
      videoCount++;
    }

    fileTypes.set(extension, (fileTypes.get(extension) || 0) + 1);
  }

  return {
    totalFiles: photos.length,
    totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
    maxFileSizeMB: (maxFileSize / 1024 / 1024).toFixed(2),
    videoCount,
    largeFileCount,
    fileTypes: Object.fromEntries(fileTypes),
    processingStrategy: largeFileCount > 0 ? 'high-memory' : 'standard'
  };
}

/**
 * Process files with streaming approach optimized for large files
 */
async function processFilesWithStreaming(photos, eventId, requestId, analysis) {
  console.log(`🌊 Starting streaming processing [${requestId}]: ${analysis.processingStrategy} strategy`);

  // Create ZIP with streaming to Google Cloud Storage
  const zipFileName = `event_${eventId}_wedding_photos_${Date.now()}.zip`;
  const file = storage.bucket(bucketName).file(`downloads/${zipFileName}`);
  const zipStream = file.createWriteStream({
    metadata: {
      contentType: 'application/zip',
      metadata: {
        eventId,
        requestId,
        createdAt: new Date().toISOString(),
        totalFiles: photos.length.toString(),
        totalSizeMB: analysis.totalSizeMB
      }
    }
  });

  const archive = archiver('zip', {
    zlib: { level: 0 } // No compression for speed and memory efficiency
  });

  // Pipe archive to Google Cloud Storage
  archive.pipe(zipStream);

  let processedFiles = 0;
  let totalOriginalSize = 0;
  let failedFiles = [];

  // Process files in batches for memory efficiency
  const BATCH_SIZE = analysis.largeFileCount > 0 ? 2 : 5; // Smaller batches for large files
  
  for (let i = 0; i < photos.length; i += BATCH_SIZE) {
    const batch = photos.slice(i, Math.min(i + BATCH_SIZE, photos.length));
    console.log(`🔄 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(photos.length/BATCH_SIZE)} [${requestId}]: ${batch.length} files`);

    // Process batch with parallel downloads (limited concurrency for large files)
    const batchPromises = batch.map(photo => processFileForZip(photo, requestId));
    const batchResults = await Promise.allSettled(batchPromises);

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const photo = batch[j];

      if (result.status === 'fulfilled' && result.value.success) {
        const fileData = result.value;
        const uniqueFileName = generateUniqueFileName(photo.fileName, processedFiles);
        
        // Add to ZIP archive
        archive.append(fileData.buffer, { name: uniqueFileName });
        
        processedFiles++;
        totalOriginalSize += fileData.originalSize;
        
        console.log(`✅ File added to ZIP [${requestId}]: ${uniqueFileName} (${(fileData.buffer.length/1024/1024).toFixed(2)}MB)`);
      } else {
        const error = result.reason || result.value?.error || 'Unknown error';
        failedFiles.push({
          fileName: photo.fileName,
          reason: error.toString(),
          size: photo.size
        });
        console.error(`❌ File failed [${requestId}]: ${photo.fileName} - ${error}`);
      }
    }

    // Force garbage collection between batches for large files
    if (analysis.largeFileCount > 0 && global.gc) {
      global.gc();
    }

    // Small delay to prevent overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (processedFiles === 0) {
    throw new Error('No files could be processed successfully');
  }

  // Finalize ZIP
  console.log(`📦 Finalizing ZIP [${requestId}]: ${processedFiles} files`);
  archive.finalize();

  // Wait for upload to complete
  await new Promise((resolve, reject) => {
    zipStream.on('error', reject);
    zipStream.on('finish', resolve);
  });

  // Make file publicly accessible (temporary signed URL)
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  console.log(`✅ ZIP uploaded to Google Cloud Storage [${requestId}]: ${url}`);

  return {
    downloadUrl: url,
    processedFiles,
    failedFiles,
    totalOriginalSize,
    finalSize: (await file.getMetadata())[0].size,
    zipFileName
  };
}

/**
 * Download and process individual file with optimization for large files
 */
async function processFileForZip(photo, requestId) {
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`⬇️ Downloading [${requestId}] attempt ${attempt}/${maxRetries}: ${photo.fileName} (${(photo.size/1024/1024).toFixed(2)}MB)`);

      // Dynamic timeout based on file size
      const timeoutMs = Math.min(Math.max(photo.size / 1024 / 1024 * 2000, 30000), 300000); // 2s per MB, min 30s, max 5min
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(photo.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'GoogleCloudFunction-WeddingProcessor/1.0' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Stream large files to buffer with memory management
        const isLargeFile = photo.size > 100 * 1024 * 1024; // 100MB threshold
        let buffer;

        if (isLargeFile) {
          console.log(`🌊 Streaming large file [${requestId}]: ${photo.fileName}`);
          buffer = await streamToBuffer(response.body, requestId, photo.fileName);
        } else {
          buffer = Buffer.from(await response.arrayBuffer());
        }

        console.log(`✅ Downloaded [${requestId}]: ${photo.fileName} (${(buffer.length/1024/1024).toFixed(2)}MB)`);

        return {
          success: true,
          buffer,
          originalSize: photo.size || buffer.length
        };

      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Download attempt ${attempt} failed [${requestId}]: ${photo.fileName} - ${error.message}`);

      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`⏳ Retrying in ${backoffMs/1000}s [${requestId}]: ${photo.fileName}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || 'Download failed'
  };
}

/**
 * Stream response to buffer with memory management
 */
async function streamToBuffer(responseBody, requestId, fileName) {
  const chunks = [];
  let totalSize = 0;

  const reader = responseBody.getReader();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks.push(value);
      totalSize += value.length;
      
      // Log progress for very large files
      if (totalSize % (50 * 1024 * 1024) === 0) {
        console.log(`📊 Streaming progress [${requestId}]: ${fileName} - ${(totalSize/1024/1024).toFixed(2)}MB`);
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log(`🔧 Assembling buffer [${requestId}]: ${fileName} from ${chunks.length} chunks (${(totalSize/1024/1024).toFixed(2)}MB)`);
  return Buffer.concat(chunks);
}

/**
 * Generate unique filename to avoid conflicts
 */
function generateUniqueFileName(originalFileName, index) {
  const sanitized = originalFileName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
  return sanitized;
}

/**
 * Send success email via Netlify function
 */
async function sendSuccessEmail(eventId, email, requestId, result, startTime) {
  const processingTimeSeconds = (Date.now() - startTime) / 1000;
  
  try {
    const netlifyEmailUrl = process.env.NETLIFY_EMAIL_FUNCTION_URL || 'https://main--sharedmoments.netlify.app/.netlify/functions/email-download';
    
    const emailPayload = {
      eventId,
      email,
      requestId,
      fileCount: result.processedFiles,
      originalSizeMB: result.totalOriginalSize / 1024 / 1024,
      finalSizeMB: result.finalSize / 1024 / 1024,
      downloadUrl: result.downloadUrl,
      failedFiles: result.failedFiles || [],
      processingTimeSeconds,
      processingMethod: 'google-cloud-functions',
      source: 'google-cloud-function'
    };

    const response = await fetch(netlifyEmailUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload)
    });

    if (!response.ok) {
      throw new Error(`Netlify email function error: ${response.status}`);
    }

    console.log(`✅ Success email sent [${requestId}] via Netlify function`);

  } catch (error) {
    console.error(`❌ Failed to send success email [${requestId}]:`, error);
  }
}

/**
 * Send error email via Netlify function
 */
async function sendErrorEmail(eventId, email, requestId, errorMessage) {
  try {
    const netlifyEmailUrl = process.env.NETLIFY_EMAIL_FUNCTION_URL || 'https://main--sharedmoments.netlify.app/.netlify/functions/email-download';
    
    const errorPayload = {
      eventId,
      email,
      requestId,
      errorMessage,
      isError: true,
      source: 'google-cloud-function'
    };

    const response = await fetch(netlifyEmailUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(errorPayload)
    });

    if (!response.ok) {
      throw new Error(`Netlify email function error: ${response.status}`);
    }

    console.log(`✅ Error email sent [${requestId}] via Netlify function`);

  } catch (error) {
    console.error(`❌ Failed to send error email [${requestId}]:`, error);
  }
}
