const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, query, collection, where, getDocs } = require('firebase/firestore');
const { getStorage, ref, getDownloadURL } = require('firebase/storage');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const archiver = require('archiver');
const nodemailer = require('nodemailer');

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);
const storage = getStorage(app);

exports.handler = async (event, context) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  
  console.log(`=== EMAIL DOWNLOAD REQUEST [${requestId}] === (v3.0 - Background Processing)`);
  
  // Set timeout handling - allow background processing
  context.callbackWaitsForEmptyEventLoop = false;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'X-Request-ID': requestId,
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed', requestId }),
    };
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body || '{}');
  } catch (parseError) {
    console.error(`❌ JSON parse error [${requestId}]:`, parseError);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: 'Invalid JSON in request body',
        requestId 
      }),
    };
  }

  const { eventId, email } = parsedBody;

  // Early validation
  if (!eventId || !email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: 'eventId and email are required',
        requestId 
      }),
    };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: 'Invalid email format',
        requestId 
      }),
    };
  }

  try {
    console.log(`📧 Processing email download [${requestId}]:`, { eventId, email });

    // Step 1: Quick file analysis to determine processing strategy
    console.log(`🔍 Analyzing files for event [${requestId}]:`, eventId);
    
    const q = query(
      collection(db, 'photos'),
      where('eventId', '==', eventId)
    );
    
    const snapshot = await getDocs(q);
    const photos = [];
    let estimatedTotalSize = 0;
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      const fileSize = data.size || 0;
      photos.push({
        id: doc.id,
        fileName: data.fileName || `photo_${doc.id}.jpg`,
        url: data.url,
        storagePath: data.storagePath,
        size: fileSize,
        mediaType: data.mediaType || 'photo'
      });
      estimatedTotalSize += fileSize;
    });

    if (photos.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'No photos found for this event',
          requestId 
        }),
      };
    }

    const fileSizeMB = estimatedTotalSize / 1024 / 1024;
    const isLargeCollection = fileSizeMB > 50; // 50MB threshold
    const videoCount = photos.filter(p => p.mediaType === 'video').length;
    const hasVideos = videoCount > 0;
    
    console.log(`📊 Collection analysis [${requestId}]:`, {
      fileCount: photos.length,
      estimatedSizeMB: fileSizeMB.toFixed(2),
      videoCount,
      isLargeCollection,
      processingStrategy: isLargeCollection ? 'background' : 'immediate'
    });

    // Step 2: Determine processing strategy
    if (isLargeCollection) {
      console.log(`🚀 Large collection detected [${requestId}] - Routing to Cloudflare Worker`);
      
      // Try Cloudflare Worker first, fallback to Netlify background processing
      try {
        const workerResult = await routeToCloudflareWorker(photos, eventId, email, requestId);
        if (workerResult.success) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(workerResult),
          };
        }
      } catch (workerError) {
        console.warn(`⚠️ Worker routing failed [${requestId}], falling back to Netlify:`, workerError.message);
      }
      
      // Fallback: Start background processing without waiting
      processLargeCollectionInBackground(photos, eventId, email, requestId, fileSizeMB, hasVideos);
      
      // Return immediate success response
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          processing: 'background',
          message: hasVideos 
            ? `Processing ${photos.length} files (${fileSizeMB.toFixed(0)}MB) including ${videoCount} videos with enhanced compression. You'll receive an email in 2-5 minutes.`
            : `Processing ${photos.length} files (${fileSizeMB.toFixed(0)}MB) with compression. You'll receive an email in 1-3 minutes.`,
          fileCount: photos.length,
          estimatedSizeMB: Math.round(fileSizeMB),
          videoCount,
          estimatedWaitTime: hasVideos ? '2-5 minutes' : '1-3 minutes',
          requestId
        }),
      };
    } else {
      // Small collection - process immediately
      console.log(`⚡ Small collection [${requestId}] - Processing immediately`);
      
      const result = await processCollectionImmediately(photos, eventId, email, requestId);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          processing: 'immediate',
          message: `Download link sent to ${email}`,
          photoCount: result.downloadedCount,
          fileSizeMB: Math.round(fileSizeMB),
          requestId
        }),
      };
    }

  } catch (error) {
    console.error(`❌ Email download failed [${requestId}]:`, error);
    
    // Always return JSON, never HTML
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process email download request',
        details: error.message,
        requestId,
        timestamp: new Date().toISOString()
      }),
    };
  }
};

// Background processing function for large collections
async function processLargeCollectionInBackground(photos, eventId, email, requestId, fileSizeMB, hasVideos) {
  console.log(`🔄 Background processing started [${requestId}]`);
  
  try {
    // Process with streaming and memory management
    const archive = archiver('zip', { 
      zlib: { level: 6 }, // Faster compression for large files
      statConcurrency: 1   // Process files one at a time
    });
    
    const zipChunks = [];
    let totalProcessed = 0;
    
    archive.on('data', (chunk) => zipChunks.push(chunk));
    archive.on('error', (error) => {
      console.error(`❌ Archive error [${requestId}]:`, error);
      throw error;
    });

    // Process files with streaming download
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      try {
        console.log(`⬇️ Processing ${i + 1}/${photos.length} [${requestId}]: ${photo.fileName}`);
        
        // Stream download to avoid memory issues - pass fileName for video detection
        const photoBuffer = await downloadFileWithRetry(photo.url, requestId, photo.fileName);
        
        if (photoBuffer) {
          const safeFileName = photo.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          archive.append(photoBuffer, { name: safeFileName });
          totalProcessed++;
          console.log(`✅ Added ${i + 1}/${photos.length} [${requestId}]: ${safeFileName}`);
        }
        
        // Memory cleanup for large files
        if (photoBuffer && photoBuffer.length > 10 * 1024 * 1024) { // 10MB+
          if (global.gc) global.gc();
        }
        
      } catch (error) {
        console.error(`❌ Failed to process file [${requestId}]:`, photo.fileName, error);
        // Continue with other files
      }
    }

    if (totalProcessed === 0) {
      throw new Error('Failed to process any files');
    }

    // Finalize archive
    archive.finalize();
    
    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const zipBuffer = Buffer.concat(zipChunks);
    const finalSizeMB = zipBuffer.length / 1024 / 1024;
    console.log(`🗜️ Archive complete [${requestId}]: ${finalSizeMB.toFixed(2)}MB`);

    // Upload to R2
    await uploadToR2AndSendEmail(zipBuffer, eventId, email, requestId, totalProcessed, finalSizeMB);
    
    console.log(`✅ Background processing complete [${requestId}]`);
    
  } catch (error) {
    console.error(`❌ Background processing failed [${requestId}]:`, error);
    
    // Send error email to user
    try {
      await sendErrorEmail(email, requestId, error.message);
    } catch (emailError) {
      console.error(`❌ Failed to send error email [${requestId}]:`, emailError);
    }
  }
}

// Immediate processing for small collections
async function processCollectionImmediately(photos, eventId, email, requestId) {
  console.log(`⚡ Immediate processing [${requestId}]`);
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  const zipChunks = [];
  
  archive.on('data', (chunk) => zipChunks.push(chunk));
  archive.on('error', (error) => {
    console.error(`❌ Archive error [${requestId}]:`, error);
    throw error;
  });

  let downloadedCount = 0;
  
  for (const photo of photos) {
    try {
      const photoBuffer = await downloadFile(photo.url);
      const safeFileName = photo.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      archive.append(photoBuffer, { name: safeFileName });
      downloadedCount++;
    } catch (error) {
      console.error(`❌ Failed to download [${requestId}]:`, photo.fileName, error);
    }
  }

  if (downloadedCount === 0) {
    throw new Error('Failed to download any photos');
  }

  archive.finalize();
  
  await new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });

  const zipBuffer = Buffer.concat(zipChunks);
  const finalSizeMB = zipBuffer.length / 1024 / 1024;
  
  await uploadToR2AndSendEmail(zipBuffer, eventId, email, requestId, downloadedCount, finalSizeMB);
  
  return { downloadedCount, finalSizeMB };
}

// Helper function to download file from URL with retry logic
async function downloadFileWithRetry(url, requestId, fileName = '', maxRetries = 3) {
  const isVideo = fileName.toLowerCase().includes('.mp4') || fileName.toLowerCase().includes('.mov') || fileName.toLowerCase().includes('.avi');
  const fileType = isVideo ? 'video' : 'image';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📥 Download attempt ${attempt}/${maxRetries} [${requestId}] (${fileType}): ${fileName}`);
      return await downloadFile(url, isVideo);
    } catch (error) {
      console.error(`❌ Download attempt ${attempt} failed [${requestId}] (${fileType}):`, error.message);
      
      // For 404 errors, the Firebase URL might have expired - try to refresh it
      if (error.message.includes('404') && attempt < maxRetries) {
        console.log(`🔄 URL might be expired [${requestId}], attempting URL refresh...`);
        // In production, you might want to refresh the Firebase URL here
        // For now, we'll just retry with longer delays
      }
      
      if (attempt === maxRetries) {
        console.error(`💥 Final download failure [${requestId}] for ${fileName}: ${error.message}`);
        throw error;
      }
      
      // Exponential backoff with longer delays for videos
      const baseDelay = isVideo ? 3000 : 1000; // 3s for videos, 1s for images
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`⏳ Waiting ${delay/1000}s before retry [${requestId}]...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Helper function to download file from URL with video optimization
async function downloadFile(url, isVideo = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    // Dynamic timeout: 90s for videos, 30s for images
    const timeout = isVideo ? 90000 : 30000;
    
    console.log(`⬇️ Starting download (timeout: ${timeout/1000}s)...`);
    
    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`🔄 Following redirect to: ${response.headers.location.substring(0, 100)}...`);
        return downloadFile(response.headers.location, isVideo).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const contentLength = parseInt(response.headers['content-length'] || '0');
      let downloadedBytes = 0;
      let lastProgressLog = 0;
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
        downloadedBytes += chunk.length;
        
        // Log progress for large files (every 25% for videos, every 50% for images)
        if (contentLength > 0) {
          const progress = (downloadedBytes / contentLength) * 100;
          const progressThreshold = isVideo ? 25 : 50;
          
          if (progress >= lastProgressLog + progressThreshold) {
            console.log(`📊 Download progress: ${Math.round(progress)}% (${Math.round(downloadedBytes/1024/1024)}MB/${Math.round(contentLength/1024/1024)}MB)`);
            lastProgressLog = Math.floor(progress / progressThreshold) * progressThreshold;
          }
        }
      });
      
      response.on('end', () => {
        const finalSizeMB = downloadedBytes / 1024 / 1024;
        console.log(`✅ Download complete: ${finalSizeMB.toFixed(2)}MB`);
        resolve(Buffer.concat(chunks));
      });
      
      response.on('error', (error) => {
        console.error(`❌ Response error:`, error.message);
        reject(error);
      });
    });
    
    request.setTimeout(timeout, () => {
      console.error(`⏰ Download timeout after ${timeout/1000}s`);
      request.destroy();
      reject(new Error(`Download timeout (${timeout/1000}s)`));
    });
    
    request.on('error', (error) => {
      console.error(`❌ Request error:`, error.message);
      reject(error);
    });
  });
}

// Upload to R2 and send email
async function uploadToR2AndSendEmail(zipBuffer, eventId, email, requestId, fileCount, fileSizeMB) {
  console.log(`☁️ Uploading to R2 [${requestId}]: ${fileSizeMB.toFixed(2)}MB`);
  
  const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const zipFileName = `event_${eventId}_photos_${Date.now()}.zip`;
  const r2Key = `downloads/${zipFileName}`;
  
  await r2Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: r2Key,
    Body: zipBuffer,
    ContentType: 'application/zip',
    Metadata: {
      eventId,
      email,
      requestId,
      createdAt: new Date().toISOString(),
      photoCount: fileCount.toString()
    }
  }));

  const downloadUrl = `${process.env.R2_PUBLIC_URL}/${r2Key}`;
  console.log(`✅ Uploaded to R2 [${requestId}]: ${downloadUrl}`);

  // Send success email
  await sendSuccessEmail(email, requestId, fileCount, fileSizeMB, downloadUrl);
}

// Send success email with download link
async function sendSuccessEmail(email, requestId, fileCount, fileSizeMB, downloadUrl) {
  console.log(`📧 Sending success email [${requestId}] to: ${email}`);
  
  const transporter = nodemailer.createTransport({
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com',
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const mailOptions = {
    from: `SharedMoments <${process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com'}>`,
    to: email,
    subject: `Your SharedMoments Photos are Ready for Download`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 1px;">
            📸 SharedMoments
          </h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
            Your event photos are ready
          </p>
        </div>
        
        <!-- Main Content -->
        <div style="padding: 40px 30px; background: white;">
          <p style="font-size: 18px; line-height: 1.6; color: #333; margin-top: 0;">
            Great news! We've prepared a professional download package with <strong>${fileCount} files</strong> from your special event.
          </p>
          
          <!-- Download Details Card -->
          <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 25px; border-radius: 12px; margin: 30px 0; border-left: 4px solid #667eea;">
            <h3 style="margin-top: 0; color: #495057; font-size: 18px;">📊 Package Details</h3>
            <div style="display: grid; gap: 12px;">
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1);">
                <span style="color: #6c757d; font-weight: 500;">Files included:</span>
                <span style="color: #495057; font-weight: 600;">${fileCount} high-quality files</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1);">
                <span style="color: #6c757d; font-weight: 500;">File size:</span>
                <span style="color: #495057; font-weight: 600;">${fileSizeMB.toFixed(2)}MB ZIP archive</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                <span style="color: #6c757d; font-weight: 500;">Available until:</span>
                <span style="color: #28a745; font-weight: 600;">1 year from event date</span>
              </div>
            </div>
          </div>
          
          <!-- Download Button -->
          <div style="text-align: center; margin: 40px 0;">
            <a href="${downloadUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); transition: all 0.3s ease;">
              📥 Download Your Photos & Videos
            </a>
          </div>
          
          <!-- Large File Notice for Videos -->
          ${fileSizeMB > 100 ? `
          <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 20px; border-radius: 12px; margin: 30px 0;">
            <div style="display: flex; align-items: flex-start;">
              <span style="font-size: 24px; margin-right: 12px;">🎬</span>
              <div>
                <h4 style="margin: 0 0 8px 0; color: #f57c00; font-size: 16px;">Large File Package</h4>
                <p style="margin: 0; color: #ef6c00; line-height: 1.5; font-size: 14px;">
                  This package includes high-quality videos and may take longer to download depending on your internet connection. The download will resume automatically if interrupted.
                </p>
              </div>
            </div>
          </div>
          ` : ''}
          
          <!-- Mobile Instructions -->
          <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 20px; border-radius: 12px; margin: 30px 0;">
            <div style="display: flex; align-items: flex-start;">
              <span style="font-size: 24px; margin-right: 12px;">📱</span>
              <div>
                <h4 style="margin: 0 0 8px 0; color: #f57c00; font-size: 16px;">Mobile Users</h4>
                <p style="margin: 0; color: #ef6c00; line-height: 1.5; font-size: 14px;">
                  On mobile devices, tap "Download" and look for the ZIP file in your Downloads folder. You may need a file manager app to extract the photos and videos.
                </p>
              </div>
            </div>
          </div>
          
          <!-- Security Notice -->
          <div style="background: #e8f5e8; border: 1px solid #4caf50; padding: 20px; border-radius: 12px; margin: 30px 0;">
            <div style="display: flex; align-items: flex-start;">
              <span style="font-size: 24px; margin-right: 12px;">🔒</span>
              <div>
                <h4 style="margin: 0 0 8px 0; color: #2e7d32; font-size: 16px;">Long-Term Access</h4>
                <p style="margin: 0; color: #388e3c; line-height: 1.5; font-size: 14px;">
                  Your photos are securely stored and available for download for one full year from the event date. You can request new download links anytime from the event page.
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 30px; text-align: center; border-radius: 0 0 12px 12px; border-top: 1px solid #e9ecef;">
          <div style="margin-bottom: 20px;">
            <h3 style="margin: 0 0 5px 0; color: #495057; font-size: 18px; font-weight: 300;">SharedMoments</h3>
            <p style="margin: 0; color: #6c757d; font-size: 14px;">Professional Photo Sharing Platform</p>
          </div>
          
          <div style="margin-bottom: 20px;">
            <a href="https://sharedmoments.socialboostai.com" style="color: #667eea; text-decoration: none; font-weight: 500;">
              sharedmoments.socialboostai.com
            </a>
          </div>
          
          <hr style="border: none; border-top: 1px solid #dee2e6; margin: 20px 0;">
          
          <p style="color: #adb5bd; font-size: 12px; margin: 10px 0 0 0; line-height: 1.4;">
            Powered by <a href="https://socialboostai.com" style="color: #667eea; text-decoration: none; font-weight: 500;">Social Boost AI</a><br>
            Wedding Marketing & Technology Solutions<br><br>
            Request ID: ${requestId} | Generated: ${new Date().toLocaleString()}
          </p>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ Success email sent [${requestId}]`);
}

// Route large collections to Cloudflare Worker for enhanced processing
async function routeToCloudflareWorker(photos, eventId, email, requestId) {
  console.log(`🚀 Routing to Cloudflare Worker [${requestId}]`);
  
  const WORKER_URL = process.env.CLOUDFLARE_WORKER_URL;
  if (!WORKER_URL) {
    throw new Error('Cloudflare Worker URL not configured');
  }
  
  try {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WORKER_AUTH_TOKEN || 'fallback-auth'}`
      },
      body: JSON.stringify({
        eventId,
        email,
        photos,
        requestId
      }),
      // 30 second timeout for worker communication
      signal: AbortSignal.timeout(30000)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Worker responded with ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`✅ Worker accepted request [${requestId}]:`, result.message);
    
    return {
      success: true,
      processing: 'worker-background',
      message: result.message,
      fileCount: photos.length,
      estimatedSizeMB: Math.round(photos.reduce((sum, p) => sum + (p.size || 0), 0) / 1024 / 1024),
      estimatedTime: result.estimatedTime,
      requestId
    };
    
  } catch (error) {
    console.warn(`⚠️ Worker routing failed [${requestId}]:`, error.message);
    throw error;
  }
}

// Send error email to user
async function sendErrorEmail(email, requestId, errorMessage) {
  console.log(`📧 Sending error email [${requestId}] to: ${email}`);
  
  const transporter = nodemailer.createTransport({
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com',
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const mailOptions = {
    from: `SharedMoments <${process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com'}>`,
    to: email,
    subject: `SharedMoments Download - Processing Issue`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 1px;">
            📸 SharedMoments
          </h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
            Download Processing Update
          </p>
        </div>
        
        <div style="padding: 40px 30px; background: white;">
          <p style="font-size: 18px; line-height: 1.6; color: #333; margin-top: 0;">
            We encountered an issue while processing your download request. Our team has been notified and will resolve this shortly.
          </p>
          
          <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 20px; border-radius: 12px; margin: 30px 0;">
            <h4 style="margin: 0 0 8px 0; color: #f57c00; font-size: 16px;">What to do next:</h4>
            <p style="margin: 0; color: #ef6c00; line-height: 1.5; font-size: 14px;">
              Please try requesting the download again from the event page. If the issue persists, our support team will contact you within 24 hours.
            </p>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            Reference ID: ${requestId}<br>
            Time: ${new Date().toLocaleString()}
          </p>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}
