const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const archiver = require('archiver');

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

// Initialize Firebase (only if not already initialized)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

exports.handler = async (event, context) => {
  console.log('Netlify bulk download function called');
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Extract eventId from path
    const pathParts = event.path.split('/');
    const eventId = pathParts[pathParts.length - 1];

    console.log('Bulk download requested for eventId:', eventId);

    if (!eventId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Event ID is required' }),
      };
    }

    // Validate environment variables
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      console.error('Missing R2 environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Server configuration error',
          details: 'R2 environment variables not properly configured'
        }),
      };
    }

    // Get all photos for this event from Firestore
    const photosQuery = query(
      collection(db, 'photos'),
      where('eventId', '==', eventId)
    );
    
    const querySnapshot = await getDocs(photosQuery);
    const photos = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      photos.push({
        id: doc.id,
        r2Key: data.r2Key,
        fileName: data.fileName || 'photo.jpg',
        contentType: data.contentType || 'image/jpeg'
      });
    });

    console.log(`Found ${photos.length} photos for event ${eventId}`);

    if (photos.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No photos found for this event' }),
      };
    }

    // Initialize R2 client
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    const chunks = [];
    
    archive.on('data', (chunk) => {
      chunks.push(chunk);
    });

    // Add each photo to the archive
    let downloadedCount = 0;
    for (const photo of photos) {
      try {
        console.log(`Downloading photo ${downloadedCount + 1}/${photos.length}: ${photo.fileName}`);
        
        const getCommand = new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: photo.r2Key,
        });

        const response = await r2Client.send(getCommand);
        
        // Convert stream to buffer
        const photoChunks = [];
        for await (const chunk of response.Body) {
          photoChunks.push(chunk);
        }
        const photoBuffer = Buffer.concat(photoChunks);

        // Add unique filename to avoid conflicts
        const fileExtension = photo.fileName.split('.').pop() || 'jpg';
        const uniqueFileName = `${String(downloadedCount + 1).padStart(3, '0')}_${photo.fileName}`;
        
        archive.append(photoBuffer, { name: uniqueFileName });
        downloadedCount++;
        
      } catch (error) {
        console.error(`Failed to download photo ${photo.fileName}:`, error);
        // Continue with other photos even if one fails
      }
    }

    console.log(`Successfully downloaded ${downloadedCount} photos`);

    // Finalize the archive
    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
      archive.finalize();
    });

    const zipBuffer = Buffer.concat(chunks);
    console.log('ZIP archive created, size:', zipBuffer.length);

    // Return the ZIP file
    const timestamp = new Date().toISOString().split('T')[0];
    const zipFileName = `photos_${eventId}_${timestamp}.zip`;

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFileName}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
      body: zipBuffer.toString('base64'),
      isBase64Encoded: true,
    };

  } catch (error) {
    console.error('Bulk download error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Bulk download failed',
        details: error.message
      }),
    };
  }
};
