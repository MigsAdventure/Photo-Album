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
  
  console.log(`=== EMAIL DOWNLOAD REQUEST [${requestId}] ===`);
  
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

    // Send email
    console.log(`📧 Sending email [${requestId}] to:`, email);
    
    const transporter = nodemailer.createTransporter({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Your Event Photos are Ready for Download`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2196F3;">📸 Your Event Photos</h2>
          
          <p>Your photos are ready for download! We've prepared a ZIP file containing <strong>${downloadedCount} photos</strong> from your event.</p>
          
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Download Details:</h3>
            <ul>
              <li><strong>Photos included:</strong> ${downloadedCount} images</li>
              <li><strong>File size:</strong> ${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB</li>
              <li><strong>Download expires:</strong> 48 hours from now</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${downloadUrl}" 
               style="background: #2196F3; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold;">
              📥 Download Photos
            </a>
          </div>
          
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #856404;">📱 Mobile Users:</h4>
            <p style="margin-bottom: 0; color: #856404;">
              On mobile devices, you may need to use a file manager app to extract the ZIP file after downloading.
            </p>
          </div>
          
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            This download link will expire in 48 hours for security. If you need the photos again, please request a new download from the event page.
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            Request ID: ${requestId} | Generated: ${new Date().toLocaleString()}
          </p>
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
