const express = require('express');
const { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { initializeApp } = require('firebase/app');
const { getFirestore, query, collection, where, getDocs } = require('firebase/firestore');
const archiver = require('archiver');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Configuration
const PORT = process.env.PORT || 8080;

// R2 Configuration
const R2_CONFIG = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET_NAME || 'sharedmoments-photos-production',
  endpoint: process.env.R2_ENDPOINT,
  publicUrl: process.env.R2_PUBLIC_URL || 'https://sharedmomentsphotos.socialboostai.com'
};

// Firebase Configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize services
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_CONFIG.endpoint,
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
  },
});

// Email transporter
const emailTransporter = nodemailer.createTransport({
  host: 'smtp.mailgun.org',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com',
    pass: process.env.EMAIL_PASSWORD
  }
});

// Health check endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'Wedding Photo Processor',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'Wedding Photo Processor',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Process wedding photos - this is the main endpoint
app.post('/process-photos', async (req, res) => {
  const requestId = uuidv4().substring(0, 8);
  const startTime = Date.now();
  
  console.log(`🚀 Processing photos [${requestId}]`);
  
  try {
    const { eventId, email } = req.body;
    
    if (!eventId || !email) {
      return res.status(400).json({
        error: 'eventId and email are required',
        requestId
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format',
        requestId
      });
    }
    
    console.log(`📊 Processing request [${requestId}]: eventId=${eventId}, email=${email}`);
    
    // Step 1: Get photos from Firestore
    const photos = await getEventPhotos(eventId, requestId);
    
    if (photos.length === 0) {
      return res.status(404).json({
        error: 'No photos found for this event',
        requestId
      });
    }
    
    const totalSizeMB = photos.reduce((sum, p) => sum + (p.size || 0), 0) / 1024 / 1024;
    console.log(`📸 Found ${photos.length} photos [${requestId}], estimated size: ${totalSizeMB.toFixed(2)}MB`);
    
    // Step 2: Process in background (Cloud Run has no timeout limits!)
    processPhotosInBackground(photos, eventId, email, requestId, startTime);
    
    // Step 3: Return immediate response
    res.json({
      success: true,
      message: `Processing ${photos.length} photos. You'll receive an email when ready.`,
      requestId,
      fileCount: photos.length,
      estimatedSizeMB: Math.round(totalSizeMB),
      estimatedTime: totalSizeMB > 100 ? '3-8 minutes' : '1-4 minutes'
    });
    
  } catch (error) {
    console.error(`❌ Error processing photos [${requestId}]:`, error);
    
    res.status(500).json({
      error: 'Failed to process photos',
      details: error.message,
      requestId
    });
  }
});

// Get photos from Firestore
async function getEventPhotos(eventId, requestId) {
  console.log(`🔍 Getting photos from Firestore [${requestId}]: ${eventId}`);
  
  const q = query(
    collection(db, 'photos'),
    where('eventId', '==', eventId)
  );
  
  const snapshot = await getDocs(q);
  const photos = [];
  
  snapshot.forEach((doc) => {
    const data = doc.data();
    photos.push({
      id: doc.id,
      fileName: data.fileName || `photo_${doc.id}.jpg`,
      url: data.url,
      storagePath: data.storagePath,
      size: data.size || 0,
      mediaType: data.mediaType || 'photo'
    });
  });
  
  console.log(`✅ Retrieved ${photos.length} photos from Firestore [${requestId}]`);
  return photos;
}

// Background processing function (no timeout limits!)
async function processPhotosInBackground(photos, eventId, email, requestId, startTime) {
  try {
    console.log(`🔄 Background processing started [${requestId}]`);
    
    // Step 1: Create archive
    const archive = archiver('zip', { 
      zlib: { level: 6 }, // Good compression/speed balance
      statConcurrency: 1   // Process one file at a time for memory efficiency
    });
    
    const zipChunks = [];
    let totalProcessed = 0;
    let totalBytes = 0;
    
    archive.on('data', (chunk) => {
      zipChunks.push(chunk);
      totalBytes += chunk.length;
    });
    
    archive.on('error', (error) => {
      console.error(`❌ Archive error [${requestId}]:`, error);
      throw error;
    });
    
    // Step 2: Process photos one by one
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      try {
        console.log(`⬇️ Processing ${i + 1}/${photos.length} [${requestId}]: ${photo.fileName}`);
        
        // Get R2 key from the photo URL or storagePath
        const r2Key = extractR2Key(photo.url, photo.storagePath);
        
        if (!r2Key) {
          console.warn(`⚠️ Could not determine R2 key for [${requestId}]: ${photo.fileName}`);
          continue;
        }
        
        // Download directly from R2 (much more reliable than Firebase URLs)
        const photoBuffer = await downloadFromR2(r2Key, requestId);
        
        if (photoBuffer && photoBuffer.length > 0) {
          const safeFileName = photo.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          archive.append(photoBuffer, { name: safeFileName });
          totalProcessed++;
          
          const sizeMB = photoBuffer.length / 1024 / 1024;
          console.log(`✅ Added ${i + 1}/${photos.length} [${requestId}]: ${safeFileName} (${sizeMB.toFixed(2)}MB)`);
        }
        
        // Memory cleanup for large files
        if (photoBuffer && photoBuffer.length > 50 * 1024 * 1024) { // 50MB+
          if (global.gc) global.gc();
        }
        
      } catch (error) {
        console.error(`❌ Failed to process file [${requestId}]:`, photo.fileName, error.message);
        // Continue with other files
      }
    }
    
    if (totalProcessed === 0) {
      throw new Error('Failed to process any photos');
    }
    
    // Step 3: Finalize archive
    console.log(`🗜️ Finalizing archive [${requestId}]: ${totalProcessed} files processed`);
    archive.finalize();
    
    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    
    const zipBuffer = Buffer.concat(zipChunks);
    const finalSizeMB = zipBuffer.length / 1024 / 1024;
    const processingTime = (Date.now() - startTime) / 1000;
    
    console.log(`✅ Archive complete [${requestId}]: ${finalSizeMB.toFixed(2)}MB in ${processingTime.toFixed(1)}s`);
    
    // Step 4: Upload ZIP back to R2
    const zipKey = await uploadZipToR2(zipBuffer, eventId, requestId);
    
    // Step 5: Send success email
    const downloadUrl = `${R2_CONFIG.publicUrl}/${zipKey}`;
    await sendSuccessEmail(email, requestId, totalProcessed, finalSizeMB, downloadUrl, processingTime);
    
    console.log(`🎉 Processing complete [${requestId}] in ${processingTime.toFixed(1)}s`);
    
  } catch (error) {
    console.error(`❌ Background processing failed [${requestId}]:`, error);
    
    // Send error email
    try {
      await sendErrorEmail(email, requestId, error.message);
    } catch (emailError) {
      console.error(`❌ Failed to send error email [${requestId}]:`, emailError);
    }
  }
}

// Extract R2 key from photo URL or storagePath
function extractR2Key(url, storagePath) {
  // Try storagePath first (most reliable)
  if (storagePath) {
    return storagePath;
  }
  
  // Try extracting from URL
  if (url && url.includes(R2_CONFIG.publicUrl)) {
    return url.replace(R2_CONFIG.publicUrl + '/', '');
  }
  
  return null;
}

// Download file directly from R2
async function downloadFromR2(key, requestId) {
  try {
    console.log(`📥 Downloading from R2 [${requestId}]: ${key}`);
    
    const command = new GetObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: key,
    });
    
    const response = await r2Client.send(command);
    
    if (!response.Body) {
      throw new Error('Empty response body');
    }
    
    // Convert stream to buffer
    const chunks = [];
    const stream = response.Body;
    
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    
    const buffer = Buffer.concat(chunks);
    const sizeMB = buffer.length / 1024 / 1024;
    
    console.log(`✅ Downloaded from R2 [${requestId}]: ${key} (${sizeMB.toFixed(2)}MB)`);
    return buffer;
    
  } catch (error) {
    console.error(`❌ R2 download failed [${requestId}]:`, key, error.message);
    throw error;
  }
}

// Upload ZIP back to R2
async function uploadZipToR2(zipBuffer, eventId, requestId) {
  const zipKey = `downloads/event_${eventId}_photos_${Date.now()}.zip`;
  
  console.log(`☁️ Uploading ZIP to R2 [${requestId}]: ${zipKey}`);
  
  const command = new PutObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: zipKey,
    Body: zipBuffer,
    ContentType: 'application/zip',
    Metadata: {
      eventId,
      requestId,
      createdAt: new Date().toISOString(),
      fileCount: '0' // Will be updated with actual count
    }
  });
  
  await r2Client.send(command);
  
  const sizeMB = zipBuffer.length / 1024 / 1024;
  console.log(`✅ ZIP uploaded to R2 [${requestId}]: ${zipKey} (${sizeMB.toFixed(2)}MB)`);
  
  return zipKey;
}

// Send success email
async function sendSuccessEmail(email, requestId, fileCount, fileSizeMB, downloadUrl, processingTime) {
  console.log(`📧 Sending success email [${requestId}] to: ${email}`);
  
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
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1);">
                <span style="color: #6c757d; font-weight: 500;">Processing time:</span>
                <span style="color: #28a745; font-weight: 600;">${processingTime.toFixed(1)} seconds</span>
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
               style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
              📥 Download Your Photos & Videos
            </a>
          </div>
          
          <!-- Success Notice -->
          <div style="background: #e8f5e8; border: 1px solid #4caf50; padding: 20px; border-radius: 12px; margin: 30px 0;">
            <div style="display: flex; align-items: flex-start;">
              <span style="font-size: 24px; margin-right: 12px;">✅</span>
              <div>
                <h4 style="margin: 0 0 8px 0; color: #2e7d32; font-size: 16px;">Reliable Processing Complete</h4>
                <p style="margin: 0; color: #388e3c; line-height: 1.5; font-size: 14px;">
                  Processed using our new simplified architecture for maximum reliability. No more timeouts or failed downloads!
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 30px; text-align: center; border-radius: 0 0 12px 12px; border-top: 1px solid #e9ecef;">
          <p style="color: #adb5bd; font-size: 12px; margin: 10px 0 0 0; line-height: 1.4;">
            Request ID: ${requestId} | Cloud Run Processor v1.0<br>
            Generated: ${new Date().toLocaleString()}
          </p>
        </div>
      </div>
    `
  };
  
  await emailTransporter.sendMail(mailOptions);
  console.log(`✅ Success email sent [${requestId}]`);
}

// Send error email
async function sendErrorEmail(email, requestId, errorMessage) {
  console.log(`📧 Sending error email [${requestId}] to: ${email}`);
  
  const mailOptions = {
    from: `SharedMoments <${process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com'}>`,
    to: email,
    subject: `SharedMoments Download - Processing Issue`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f44336; color: white; padding: 20px; text-align: center;">
          <h1>SharedMoments</h1>
          <p>Download Processing Update</p>
        </div>
        
        <div style="padding: 30px; background: white;">
          <p>We encountered an issue while processing your download request. Our team has been notified.</p>
          
          <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin: 0 0 8px 0;">What to do next:</h4>
            <p style="margin: 0;">Please try requesting the download again. If the issue persists, contact support.</p>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            Reference ID: ${requestId}<br>
            Time: ${new Date().toLocaleString()}<br>
            Error: ${errorMessage}
          </p>
        </div>
      </div>
    `
  };
  
  await emailTransporter.sendMail(mailOptions);
  console.log(`📧 Error email sent [${requestId}]`);
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Wedding Photo Processor listening on port ${PORT}`);
  console.log(`📊 Memory limit: ${process.env.MEMORY_LIMIT || 'unlimited'}`);
  console.log(`⏰ Timeout: No limits (Cloud Run)`);
  console.log(`💾 R2 Bucket: ${R2_CONFIG.bucketName}`);
});
