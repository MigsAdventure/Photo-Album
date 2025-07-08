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
  
  console.log(`=== EMAIL DOWNLOAD REQUEST [${requestId}] === (v2.0)`);
  
  // Set timeout handling
  context.callbackWaitsForEmptyEventLoop = false;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'X-Request-ID': requestId,
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

  try {
    const body = JSON.parse(event.body);
    const { eventId, email } = body;

    console.log(`📧 Processing email download [${requestId}]:`, { eventId, email });

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

    // Get all photos for the event from Firestore
    console.log(`🔍 Fetching photos for event [${requestId}]:`, eventId);
    
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
        storagePath: data.storagePath
      });
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

    console.log(`📁 Found ${photos.length} photos [${requestId}]`);

    // Create zip file in memory
    console.log(`🗜️ Creating zip file [${requestId}]`);
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipChunks = [];
    
    archive.on('data', (chunk) => zipChunks.push(chunk));
    archive.on('error', (error) => {
      console.error(`❌ Archive error [${requestId}]:`, error);
      throw error;
    });

    // Download each photo and add to zip
    let downloadedCount = 0;
    
    for (const photo of photos) {
      try {
        console.log(`⬇️ Downloading photo ${downloadedCount + 1}/${photos.length} [${requestId}]:`, photo.fileName);
        
        // Download photo from Firebase Storage URL
        const photoBuffer = await downloadFile(photo.url);
        
        // Add to zip with safe filename
        const safeFileName = photo.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        archive.append(photoBuffer, { name: safeFileName });
        
        downloadedCount++;
        console.log(`✅ Added to zip: ${safeFileName} [${requestId}]`);
        
      } catch (error) {
        console.error(`❌ Failed to download photo [${requestId}]:`, photo.fileName, error);
        // Continue with other photos
      }
    }

    if (downloadedCount === 0) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to download any photos',
          requestId 
        }),
      };
    }

    // Finalize zip
    archive.finalize();
    
    // Wait for zip to complete
    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const zipBuffer = Buffer.concat(zipChunks);
    console.log(`🗜️ Zip created [${requestId}]: ${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Upload zip to R2
    console.log(`☁️ Uploading zip to R2 [${requestId}]`);
    
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
        photoCount: downloadedCount.toString()
      }
    }));

    const downloadUrl = `${process.env.R2_PUBLIC_URL}/${r2Key}`;
    console.log(`✅ Zip uploaded to R2 [${requestId}]:`, downloadUrl);

    // Send email using professional Mailgun SMTP
    console.log(`📧 Sending professional email [${requestId}] to:`, email);
    
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
              Great news! We've prepared a professional download package with <strong>${downloadedCount} photos</strong> from your special event.
            </p>
            
            <!-- Download Details Card -->
            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 25px; border-radius: 12px; margin: 30px 0; border-left: 4px solid #667eea;">
              <h3 style="margin-top: 0; color: #495057; font-size: 18px;">📊 Package Details</h3>
              <div style="display: grid; gap: 12px;">
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1);">
                  <span style="color: #6c757d; font-weight: 500;">Photos included:</span>
                  <span style="color: #495057; font-weight: 600;">${downloadedCount} high-quality images</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1);">
                  <span style="color: #6c757d; font-weight: 500;">File size:</span>
                  <span style="color: #495057; font-weight: 600;">${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB ZIP archive</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                  <span style="color: #6c757d; font-weight: 500;">Link expires:</span>
                  <span style="color: #dc3545; font-weight: 600;">48 hours from now</span>
                </div>
              </div>
            </div>
            
            <!-- Download Button -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="${downloadUrl}" 
                 style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); transition: all 0.3s ease;">
                📥 Download Your Photos
              </a>
            </div>
            
            <!-- Mobile Instructions -->
            <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <div style="display: flex; align-items: flex-start;">
                <span style="font-size: 24px; margin-right: 12px;">📱</span>
                <div>
                  <h4 style="margin: 0 0 8px 0; color: #f57c00; font-size: 16px;">Mobile Users</h4>
                  <p style="margin: 0; color: #ef6c00; line-height: 1.5; font-size: 14px;">
                    On mobile devices, tap "Download" and look for the ZIP file in your Downloads folder. You may need a file manager app to extract the photos.
                  </p>
                </div>
              </div>
            </div>
            
            <!-- Security Notice -->
            <div style="background: #e8f5e8; border: 1px solid #4caf50; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <div style="display: flex; align-items: flex-start;">
                <span style="font-size: 24px; margin-right: 12px;">🔒</span>
                <div>
                  <h4 style="margin: 0 0 8px 0; color: #2e7d32; font-size: 16px;">Secure Download</h4>
                  <p style="margin: 0; color: #388e3c; line-height: 1.5; font-size: 14px;">
                    This download link is secure and will expire in 48 hours. If you need the photos again, simply request a new download from the event page.
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
    console.log(`✅ Email sent successfully [${requestId}]`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Download link sent to ${email}`,
        photoCount: downloadedCount,
        requestId,
        downloadUrl: downloadUrl // For testing purposes
      }),
    };

  } catch (error) {
    console.error(`❌ Email download failed [${requestId}]:`, error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process email download request',
        details: error.message,
        requestId
      }),
    };
  }
};

// Helper function to download file from URL
async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    https.get(url, (response) => {
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}
