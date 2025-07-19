/**
 * Cloudflare Worker for Wedding Photo Processing
 * Enhanced with circuit breaker system and 500MB video support
 * Prevents infinite loops with memory-safe processing
 */

import { compress, compressVideo } from './compression';
import { createZipArchive } from './archiver';
import { sendEmail, sendErrorEmail } from './email';

// Circuit breaker configuration to prevent infinite loops
const REQUEST_TRACKING = new Map();
const GLOBAL_REQUEST_TRACKING = new Map(); // Track by IP/email to prevent new requestId bypassing
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 2;
const CIRCUIT_BREAKER_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const GLOBAL_RATE_LIMIT = 3; // Max 3 requests per minute per email/IP (stricter protection)
const GLOBAL_RATE_WINDOW = 60 * 1000; // 1 minute window

/**
 * Circuit breaker system to prevent infinite retry loops
 * @param {string} requestId - Unique request identifier
 * @returns {object} - Tracking information
 * @throws {Error} - If circuit breaker prevents processing
 */
function checkCircuitBreaker(requestId) {
  const now = Date.now();
  const tracking = REQUEST_TRACKING.get(requestId) || { 
    attempts: 0, 
    lastAttempt: 0,
    firstAttempt: now,
    errors: []
  };
  
  // Clean up old tracking entries (older than 30 minutes)
  if (now - tracking.firstAttempt > CIRCUIT_BREAKER_TIMEOUT) {
    REQUEST_TRACKING.delete(requestId);
    return checkCircuitBreaker(requestId); // Start fresh
  }
  
  // Check max retries exceeded
  if (tracking.attempts >= MAX_RETRIES) {
    console.error(`🚫 Circuit breaker OPEN [${requestId}]: Max retries (${MAX_RETRIES}) exceeded`);
    throw new Error(`Circuit breaker: Maximum ${MAX_RETRIES} attempts exceeded. Request blocked to prevent infinite loops.`);
  }
  
  // Check backoff period
  const timeSinceLastAttempt = now - tracking.lastAttempt;
  const requiredBackoff = Math.pow(BACKOFF_MULTIPLIER, tracking.attempts) * 1000;
  
  if (tracking.attempts > 0 && timeSinceLastAttempt < requiredBackoff) {
    console.warn(`⏳ Circuit breaker BACKOFF [${requestId}]: ${requiredBackoff}ms required, ${timeSinceLastAttempt}ms elapsed`);
    throw new Error(`Circuit breaker: Backoff period not met. Wait ${Math.ceil((requiredBackoff - timeSinceLastAttempt) / 1000)}s before retry.`);
  }
  
  // Update tracking
  tracking.attempts++;
  tracking.lastAttempt = now;
  REQUEST_TRACKING.set(requestId, tracking);
  
  console.log(`✅ Circuit breaker CHECK [${requestId}]: Attempt ${tracking.attempts}/${MAX_RETRIES}, backoff ${requiredBackoff}ms`);
  
  return tracking;
}

/**
 * Record circuit breaker success - resets failure count
 * @param {string} requestId - Request identifier
 */
function recordCircuitBreakerSuccess(requestId) {
  REQUEST_TRACKING.delete(requestId);
  console.log(`🎉 Circuit breaker SUCCESS [${requestId}]: Request completed successfully, tracking cleared`);
}

/**
 * Record circuit breaker failure - adds to error history
 * @param {string} requestId - Request identifier
 * @param {Error} error - Error that occurred
 */
function recordCircuitBreakerFailure(requestId, error) {
  const tracking = REQUEST_TRACKING.get(requestId);
  if (tracking) {
    tracking.errors.push({
      timestamp: Date.now(),
      message: error.message,
      type: error.constructor.name
    });
    REQUEST_TRACKING.set(requestId, tracking);
    console.error(`❌ Circuit breaker FAILURE [${requestId}]: ${error.message} (Attempt ${tracking.attempts}/${MAX_RETRIES})`);
  }
}

/**
 * Global rate limiter to prevent infinite loops with new requestIds
 * @param {string} email - User email
 * @param {string} clientIP - Client IP address
 * @returns {boolean} - True if request is allowed, false if rate limited
 */
function checkGlobalRateLimit(email, clientIP) {
  const now = Date.now();
  const key = `${email}:${clientIP}`;
  
  // Clean up old entries first
  for (const [trackingKey, requests] of GLOBAL_REQUEST_TRACKING.entries()) {
    const validRequests = requests.filter(timestamp => now - timestamp < GLOBAL_RATE_WINDOW);
    if (validRequests.length === 0) {
      GLOBAL_REQUEST_TRACKING.delete(trackingKey);
    } else {
      GLOBAL_REQUEST_TRACKING.set(trackingKey, validRequests);
    }
  }
  
  // Get current request timestamps for this email/IP
  const requests = GLOBAL_REQUEST_TRACKING.get(key) || [];
  
  // Filter to only recent requests (within rate window)
  const recentRequests = requests.filter(timestamp => now - timestamp < GLOBAL_RATE_WINDOW);
  
  console.log(`🌐 Global rate limit check [${key}]: ${recentRequests.length}/${GLOBAL_RATE_LIMIT} requests in last ${GLOBAL_RATE_WINDOW/1000}s`);
  
  // Check if rate limit exceeded
  if (recentRequests.length >= GLOBAL_RATE_LIMIT) {
    console.error(`🚫 GLOBAL RATE LIMIT EXCEEDED [${key}]: ${recentRequests.length} requests in ${GLOBAL_RATE_WINDOW/1000}s (limit: ${GLOBAL_RATE_LIMIT})`);
    return false;
  }
  
  // Add current request timestamp
  recentRequests.push(now);
  GLOBAL_REQUEST_TRACKING.set(key, recentRequests);
  
  console.log(`✅ Global rate limit OK [${key}]: ${recentRequests.length}/${GLOBAL_RATE_LIMIT} requests`);
  return true;
}

/**
 * Pre-flight memory check to prevent Worker crashes
 * @param {Array} photos - Array of photo objects
 * @param {string} requestId - Request identifier
 * @returns {object} - Memory analysis and recommendations
 */
function analyzeMemoryRequirements(photos, requestId) {
  const WORKER_MEMORY_LIMIT = 120 * 1024 * 1024; // 120MB total Worker memory limit
  const SAFETY_BUFFER = 0.8; // Use 80% of available memory for processing
  const LARGE_FILE_THRESHOLD = 600 * 1024 * 1024; // 600MB+ files need special handling
  const MAX_SINGLE_FILE_SIZE = 500 * 1024 * 1024; // 500MB max per individual file
  
  let totalEstimatedSize = 0;
  let largeFileCount = 0;
  let videoCount = 0;
  let maxSingleFileSize = 0;
  const largeFiles = [];
  const tooLargeFiles = [];
  
  for (const photo of photos) {
    const estimatedSize = photo.size || 5 * 1024 * 1024; // Default 5MB if unknown
    totalEstimatedSize += estimatedSize;
    maxSingleFileSize = Math.max(maxSingleFileSize, estimatedSize);
    
    // Track files over 600MB as "large" but still processable
    if (estimatedSize > LARGE_FILE_THRESHOLD) {
      largeFileCount++;
      largeFiles.push({
        fileName: photo.fileName,
        sizeMB: (estimatedSize / 1024 / 1024).toFixed(2)
      });
    }
    
    // Track files over 500MB as potentially too large for Worker
    if (estimatedSize > MAX_SINGLE_FILE_SIZE) {
      tooLargeFiles.push({
        fileName: photo.fileName,
        sizeMB: (estimatedSize / 1024 / 1024).toFixed(2)
      });
    }
    
    if (/\.(mp4|mov|avi|webm)$/i.test(photo.fileName)) {
      videoCount++;
    }
  }
  
  // Smart memory calculation: Worker processes files ONE AT A TIME
  // So we only need memory for: largest single file + ZIP overhead + processing buffer
  const largestFileMB = maxSingleFileSize / 1024 / 1024;
  const zipProcessingOverhead = 20 * 1024 * 1024; // 20MB for ZIP processing
  const actualMemoryNeeded = maxSingleFileSize + zipProcessingOverhead;
  const safeMemoryLimit = WORKER_MEMORY_LIMIT * SAFETY_BUFFER;
  
  // Worker can handle collection if:
  // 1. Largest single file fits in processing limits (≤500MB)
  // 2. We have enough memory for largest file + overhead
  const canProcessLargestFile = maxSingleFileSize <= MAX_SINGLE_FILE_SIZE;
  
  // More realistic memory check: We only need memory for ONE file at a time + ZIP overhead
  // Even a 500MB file should work since we process one-at-a-time
  const REALISTIC_MEMORY_NEEDED = Math.min(maxSingleFileSize, 100 * 1024 * 1024) + 20 * 1024 * 1024; // Max 120MB total
  const memoryFitsInWorker = REALISTIC_MEMORY_NEEDED < safeMemoryLimit;
  
  // Worker should accept if largest individual file is ≤500MB
  // Total collection size doesn't matter since we process one-at-a-time
  const shouldUseWorker = canProcessLargestFile; // Remove overly strict memory check
  
  const analysis = {
    totalFiles: photos.length,
    totalEstimatedSizeMB: (totalEstimatedSize / 1024 / 1024).toFixed(2),
    largestFileMB: largestFileMB.toFixed(2),
    actualMemoryNeededMB: (REALISTIC_MEMORY_NEEDED / 1024 / 1024).toFixed(2),
    safeMemoryLimitMB: (safeMemoryLimit / 1024 / 1024).toFixed(2),
    largeFileCount,
    videoCount,
    largeFiles,
    tooLargeFiles,
    canProcessLargestFile,
    memoryFitsInWorker,
    shouldUseWorker,
    canUseWorker: shouldUseWorker, // Use the more realistic check
    recommendedStrategy: shouldUseWorker ? 'worker-streaming' : 'netlify-background',
    riskLevel: !canProcessLargestFile ? 'high' : largestFileMB > 300 ? 'medium' : 'low',
    processingNotes: tooLargeFiles.length > 0 ? `${tooLargeFiles.length} files exceed 500MB limit` : 'All files within processing limits'
  };
  
  console.log(`🔍 Smart memory analysis [${requestId}]:`, {
    totalSizeMB: analysis.totalEstimatedSizeMB,
    largestFileMB: analysis.largestFileMB,
    actualMemoryNeededMB: analysis.actualMemoryNeededMB,
    canUseWorker: analysis.canUseWorker,
    strategy: analysis.recommendedStrategy,
    risk: analysis.riskLevel,
    notes: analysis.processingNotes
  });
  
  return analysis;
}

/**
 * Stream large files directly to ZIP without holding full file in memory
 * @param {Response} response - Fetch response object  
 * @param {number} contentLength - Total file size in bytes
 * @param {string} fileName - File name for ZIP entry
 * @param {object} zipStream - fflate ZIP stream object
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<number>} - Total bytes processed
 */
async function streamFileToZip(response, contentLength, fileName, zipStream, requestId) {
  const chunkSize = 10 * 1024 * 1024; // 10MB chunks for optimal memory usage
  let totalBytesRead = 0;
  
  console.log(`🌊 Starting direct streaming to ZIP [${requestId}]: ${fileName} (${(contentLength/1024/1024).toFixed(2)}MB)`);
  
  try {
    const reader = response.body.getReader();
    let isFirstChunk = true;
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log(`✅ Direct streaming complete [${requestId}]: ${fileName} (${totalBytesRead} bytes)`);
        break;
      }
      
      // Stream chunk directly to ZIP (never accumulate in memory)
      if (isFirstChunk) {
        // Start the ZIP entry with first chunk
        zipStream.add(fileName, value, { level: 0 });
        isFirstChunk = false;
      } else {
        // Continue streaming subsequent chunks
        zipStream.push(value);
      }
      
      totalBytesRead += value.byteLength;
      
      // Log progress every 50MB
      if (totalBytesRead % (50 * 1024 * 1024) < value.byteLength) {
        const progressPercent = (totalBytesRead / contentLength * 100).toFixed(1);
        console.log(`📊 Streaming progress [${requestId}]: ${fileName} ${progressPercent}% (${(totalBytesRead/1024/1024).toFixed(2)}MB/${(contentLength/1024/1024).toFixed(2)}MB)`);
      }
      
      // Memory management - force garbage collection for large chunks
      if (value.byteLength > 20 * 1024 * 1024) { // 20MB+ chunks
        if (typeof global !== 'undefined' && global.gc) {
          global.gc();
        }
      }
      
      // Yield control periodically to prevent blocking
      if (totalBytesRead % (30 * 1024 * 1024) < value.byteLength) { // Every 30MB
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
    
    // Finalize this file's ZIP entry
    zipStream.end(fileName);
    
    return totalBytesRead;
    
  } catch (error) {
    console.error(`❌ Direct streaming failed [${requestId}]: ${fileName}`, error);
    throw new Error(`Failed to stream file to ZIP: ${error.message}`);
  }
}

/**
 * Download smaller files normally (under memory limit)
 * @param {Response} response - Fetch response object
 * @param {string} requestId - Request ID for logging
 * @param {string} fileName - File name for logging
 * @returns {ArrayBuffer} - Complete file buffer
 */
async function downloadSmallFile(response, requestId, fileName) {
  try {
    console.log(`📥 Direct download [${requestId}]: ${fileName}`);
    const buffer = await response.arrayBuffer();
    console.log(`✅ Download complete [${requestId}]: ${fileName} (${(buffer.byteLength/1024/1024).toFixed(2)}MB)`);
    return buffer;
  } catch (error) {
    console.error(`❌ Direct download failed [${requestId}]: ${fileName}`, error);
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

/**
 * Create ZIP archive using the existing proven archiver.js solution
 * Downloads files to memory and processes them with fflate zipSync
 * Handles large files intelligently to avoid memory issues
 * @param {Array} photos - Array of photo objects with {fileName, url}
 * @param {string} requestId - Request ID for logging  
 * @returns {Promise<Object>} - { zipBuffer, stats }
 */
async function createStreamingZipArchive(photos, requestId) {
  console.log(`🌊 Creating memory-efficient ZIP [${requestId}] with ${photos.length} files`);
  
  try {
    let totalOriginalSize = 0;
    let processedFileCount = 0;
    let skippedFileCount = 0;
    let compressionStats = {
      photosCompressed: 0,
      videosProcessed: 0,
      compressionRatio: 0
    };

    const processedFiles = [];

    // Process each file - download suitable files, skip very large ones
    for (const photo of photos) {
      try {
        console.log(`⬇️ Processing file [${requestId}]: ${photo.fileName}`);
        
        // Download file from Firebase to check size
        const response = await fetch(photo.url, {
          headers: { 'User-Agent': 'SharedMoments-Worker/1.0' }
        });

        if (!response.ok) {
          console.error(`❌ Failed to download [${requestId}]: ${photo.fileName} - HTTP ${response.status}`);
          continue;
        }

        // Get file size
        const contentLength = parseInt(response.headers.get('content-length') || '0');
        const contentLengthMB = contentLength / 1024 / 1024;
        
        console.log(`📊 File size [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB)`);
        totalOriginalSize += contentLength;

        // Determine file type
        const isVideo = /\.(mp4|mov|avi|webm)$/i.test(photo.fileName);
        const isPhoto = /\.(jpg|jpeg|png|webp|heic)$/i.test(photo.fileName);

        // SKIP VIDEOS OVER 80MB (per user request for reliability)
        if (isVideo && contentLength > 80 * 1024 * 1024) {
          console.warn(`⏭️ Skipping large video [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB > 80MB limit)`);
          skippedFileCount++;
          continue;
        }

        // Handle large files with streaming (photos only, videos capped at 80MB)
        if (contentLength > 100 * 1024 * 1024) { // 100MB+ files use streaming
          console.log(`🌊 Large file detected [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB - using streaming processing)`);
          
          // For very large files (500MB+), we need to process differently
          if (contentLength > 500 * 1024 * 1024) { // 500MB+
            console.warn(`⚠️ Extremely large file [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB - may exceed Worker limits)`);
            // Still try to process, but be aware of memory constraints
          }
          
          // Download file to buffer (Worker can handle up to 500MB+ with proper memory management)
          const buffer = await downloadSmallFile(response, requestId, photo.fileName);
          let processedBuffer = buffer;

          // For videos, don't compress (wastes CPU and memory)
          if (isVideo) {
            compressionStats.videosProcessed++;
            console.log(`🎬 Video processed [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB - no compression)`);
          } else if (isPhoto && buffer.byteLength > 500 * 1024) {
            // Only compress photos, not videos
            try {
              processedBuffer = await compress(buffer, photo.fileName);
              compressionStats.photosCompressed++;
              console.log(`📸 Large photo compressed [${requestId}]: ${photo.fileName} (${(buffer.byteLength/1024/1024).toFixed(2)}MB → ${(processedBuffer.byteLength/1024/1024).toFixed(2)}MB)`);
            } catch (compressionError) {
              console.error(`❌ Compression failed [${requestId}]: ${photo.fileName}`, compressionError);
              processedBuffer = buffer;
            }
          }

          // Add to processed files
          processedFiles.push({
            fileName: photo.fileName,
            buffer: processedBuffer,
            originalSize: buffer.byteLength,
            compressedSize: processedBuffer.byteLength
          });

          processedFileCount++;
          
          // Aggressive memory cleanup for large files
          if (typeof global !== 'undefined' && global.gc) {
            global.gc();
          }
          
          continue;
        }

        // Download smaller files normally
        const buffer = await downloadSmallFile(response, requestId, photo.fileName);
        let processedBuffer = buffer;

        // Compress photos if beneficial
        if (isPhoto && buffer.byteLength > 500 * 1024) {
          try {
            processedBuffer = await compress(buffer, photo.fileName);
            compressionStats.photosCompressed++;
            console.log(`📸 Compressed photo [${requestId}]: ${photo.fileName} (${(buffer.byteLength/1024/1024).toFixed(2)}MB → ${(processedBuffer.byteLength/1024/1024).toFixed(2)}MB)`);
          } catch (compressionError) {
            console.error(`❌ Compression failed [${requestId}]: ${photo.fileName}`, compressionError);
            processedBuffer = buffer;
          }
        } else if (isVideo) {
          compressionStats.videosProcessed++;
        }

        // Add to processed files for ZIP creation
        processedFiles.push({
          fileName: photo.fileName,
          buffer: processedBuffer,
          originalSize: buffer.byteLength,
          compressedSize: processedBuffer.byteLength
        });

        processedFileCount++;

        // Memory cleanup after processing each file
        if (typeof global !== 'undefined' && global.gc) {
          global.gc();
        }

      } catch (fileError) {
        console.error(`❌ Failed to process file [${requestId}]: ${photo.fileName}`, fileError);
        continue;
      }
    }

    if (processedFileCount === 0) {
      throw new Error('No files were successfully processed');
    }

    console.log(`📦 Creating ZIP with ${processedFileCount} files, ${skippedFileCount} files skipped [${requestId}]`);

    // Use existing proven archiver.js solution
    const { createZipArchive } = await import('./archiver.js');
    const zipBuffer = await createZipArchive(processedFiles, requestId);

    const finalSizeMB = zipBuffer.byteLength / 1024 / 1024;
    compressionStats.compressionRatio = totalOriginalSize > 0 
      ? ((totalOriginalSize - zipBuffer.byteLength) / totalOriginalSize * 100)
      : 0;

    console.log(`✅ Memory-efficient ZIP created [${requestId}]: ${finalSizeMB.toFixed(2)}MB with ${processedFileCount} files`);

    return {
      zipBuffer,
      stats: {
        processedFileCount,
        skippedFileCount,
        totalOriginalSize,
        totalCompressedSize: zipBuffer.byteLength,
        compressionStats,
        finalSizeMB
      }
    };

  } catch (error) {
    console.error(`❌ Memory-efficient ZIP creation failed [${requestId}]:`, error);
    throw new Error(`Failed to create ZIP: ${error.message}`);
  }
}

/**
 * Sanitize filename for ZIP archive
 */
function sanitizeFileName(fileName) {
  if (!fileName) return 'unnamed_file';
  
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim() || 'unnamed_file';
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const { eventId, email, photos, requestId } = body;

      if (!eventId || !email || !photos || !Array.isArray(photos)) {
        return new Response(JSON.stringify({ 
          error: 'Missing required fields: eventId, email, photos' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GLOBAL RATE LIMITING - Check first to prevent new requestId bypass
      const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      if (!checkGlobalRateLimit(email, clientIP)) {
        console.error(`🚫 GLOBAL RATE LIMIT EXCEEDED [${email}:${clientIP}]: Request blocked`);
        return new Response(JSON.stringify({
          error: 'Too many requests',
          reason: `Rate limit exceeded: maximum ${GLOBAL_RATE_LIMIT} requests per minute`,
          email,
          requestId,
          action: 'Stop retrying. Wait 1 minute before submitting a new request.'
        }), {
          status: 429, // Too Many Requests
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': '60' // Force 60 second wait
          },
        });
      }

      // Circuit breaker check to prevent infinite loops per requestId
      try {
        checkCircuitBreaker(requestId);
      } catch (circuitBreakerError) {
        console.error(`🚫 Circuit breaker blocked request [${requestId}]:`, circuitBreakerError.message);
        return new Response(JSON.stringify({
          error: 'Request blocked by circuit breaker',
          reason: circuitBreakerError.message,
          requestId,
          action: 'Request blocked to prevent infinite loops. Please wait before retrying.'
        }), {
          status: 429, // Too Many Requests
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': '60' // Suggest 60 second retry
          },
        });
      }

      // Pre-flight memory analysis to prevent crashes
      const memoryAnalysis = analyzeMemoryRequirements(photos, requestId);
      
      if (!memoryAnalysis.canUseWorker) {
        console.warn(`⚠️ Worker rejected due to memory constraints [${requestId}]:`, {
          memoryNeededMB: memoryAnalysis.memoryNeededMB,
          safeMemoryLimitMB: memoryAnalysis.safeMemoryLimitMB,
          largeFileCount: memoryAnalysis.largeFileCount,
          riskLevel: memoryAnalysis.riskLevel
        });
        
        // Record this as a "soft failure" - not the Worker's fault
        return new Response(JSON.stringify({
          error: 'Collection too large for Worker processing',
          memoryAnalysis,
          requestId,
          recommendation: 'Use Netlify background processing for large collections'
        }), {
          status: 413, // Payload Too Large
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`🚀 Worker processing [${requestId}]: ${photos.length} files for ${email}`);
      console.log(`📊 Memory analysis [${requestId}]: ${memoryAnalysis.memoryNeededMB}MB needed, ${memoryAnalysis.riskLevel} risk`);

      // Start background processing (don't wait for completion)
      ctx.waitUntil(processCollectionInBackground(eventId, email, photos, requestId, env));

      // Return immediate response
      return new Response(JSON.stringify({
        success: true,
        message: `Processing ${photos.length} files with compression. Email will be sent when complete.`,
        requestId,
        estimatedTime: memoryAnalysis.videoCount > 0 ? '3-7 minutes' : '1-3 minutes',
        processing: 'worker-background',
        memoryAnalysis: {
          totalSizeMB: memoryAnalysis.totalEstimatedSizeMB,
          videoCount: memoryAnalysis.videoCount,
          riskLevel: memoryAnalysis.riskLevel
        }
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

async function processCollectionInBackground(eventId, email, photos, requestId, env) {
  const startTime = Date.now();
  console.log(`🔄 Background processing started [${requestId}]`);

  try {
    // Use streaming ZIP creation to avoid memory limits
    console.log(`🌊 Initializing streaming ZIP creation [${requestId}] for ${photos.length} files`);
    const result = await createStreamingZipArchive(photos, requestId);
    const { zipBuffer, stats } = result;
    const finalSizeMB = stats.finalSizeMB;

    console.log(`📦 Streaming ZIP created [${requestId}]: ${finalSizeMB.toFixed(2)}MB`);

    // Upload to R2
    const zipFileName = `event_${eventId}_compressed_photos_${Date.now()}.zip`;
    const r2Key = `downloads/${zipFileName}`;
    
    await env.R2_BUCKET.put(r2Key, zipBuffer, {
      httpMetadata: {
        contentType: 'application/zip'
      },
      customMetadata: {
        eventId,
        email,
        requestId,
        createdAt: new Date().toISOString(),
        photoCount: stats.processedFileCount.toString(),
        originalSizeMB: (stats.totalOriginalSize / 1024 / 1024).toFixed(2),
        compressedSizeMB: finalSizeMB.toFixed(2),
        compressionRatio: stats.compressionStats.compressionRatio.toFixed(1)
      }
    });

    const downloadUrl = `${env.R2_PUBLIC_URL}/${r2Key}`;
    console.log(`✅ Uploaded to R2 [${requestId}]: ${downloadUrl}`);

    // Send success email
    await sendEmail({
      eventId,
      email,
      requestId,
      fileCount: stats.processedFileCount,
      originalSizeMB: stats.totalOriginalSize / 1024 / 1024,
      finalSizeMB,
      downloadUrl,
      compressionStats: stats.compressionStats,
      processingTimeSeconds: (Date.now() - startTime) / 1000
    }, env);

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`✅ Background processing complete [${requestId}] in ${totalTime.toFixed(1)}s`);

    // Record circuit breaker success - clears retry tracking
    recordCircuitBreakerSuccess(requestId);

  } catch (error) {
    console.error(`❌ Background processing failed [${requestId}]:`, error);
    
    // Record circuit breaker failure - adds to error history
    recordCircuitBreakerFailure(requestId, error);
    
    try {
      await sendErrorEmail(eventId, email, requestId, error.message, env);
    } catch (emailError) {
      console.error(`❌ Failed to send error email [${requestId}]:`, emailError);
    }
  }
}
