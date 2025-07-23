const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

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
  console.log('Netlify download function called - FIXED VERSION');
  console.log('Environment check:', {
    hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
    hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasR2BucketName: !!process.env.R2_BUCKET_NAME,
    hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY
  });
  
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
    // Validate environment variables early
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      console.error('Missing R2 environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Server configuration error - missing R2 credentials',
          details: 'R2 environment variables not properly configured'
        }),
      };
    }

    if (!process.env.REACT_APP_FIREBASE_API_KEY || !process.env.REACT_APP_FIREBASE_PROJECT_ID) {
      console.error('Missing Firebase environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Server configuration error - missing Firebase credentials',
          details: 'Firebase environment variables not properly configured'
        }),
      };
    }

    // Extract photoId from query parameters (not path)
    const photoId = event.queryStringParameters?.id;

    console.log('Download requested for photoId:', photoId);

    if (!photoId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Photo ID is required in query parameter: ?id=photoId' }),
      };
    }

    // Get photo metadata from Firestore
    console.log('Fetching photo metadata from Firestore...');
    const photoDocRef = doc(db, 'photos', photoId);
    const photoDoc = await getDoc(photoDocRef);

    if (!photoDoc.exists()) {
      console.log('Photo not found in Firestore');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Photo not found' }),
      };
    }

    const photoData = photoDoc.data();
    console.log('Photo data:', { 
      hasR2Key: !!photoData.r2Key, 
      fileName: photoData.fileName,
      contentType: photoData.contentType,
      r2KeyType: typeof photoData.r2Key,
      r2KeyValue: photoData.r2Key,
      url: photoData.url
    });

    const { r2Key, fileName, contentType, url } = photoData;

    // Check if photo has been migrated to R2
    const hasValidR2Key = r2Key && typeof r2Key === 'string' && r2Key.trim().length > 0;
    
    console.log('Storage Analysis:', {
      photoId: photoId,
      hasR2Key: hasValidR2Key,
      r2Key: r2Key || 'null/empty',
      hasFirebaseUrl: !!url,
      strategy: hasValidR2Key ? 'R2_DOWNLOAD' : 'FIREBASE_PROXY'
    });

    if (hasValidR2Key) {
      // Download from R2 (preferred for new photos)
      console.log('✅ Using R2 download for migrated photo:', r2Key);
      
      try {
        // Initialize R2 client
        const r2Client = new S3Client({
          region: 'auto',
          endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
          },
        });

        const getCommand = new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: r2Key,
        });

        const response = await r2Client.send(getCommand);
        
        if (!response.Body) {
          console.log('❌ No body in R2 response, falling back to Firebase');
          throw new Error('No body in R2 response');
        }

        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of response.Body) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        console.log('✅ R2 file loaded, size:', buffer.length);

        console.log(`✅ R2 download initiated for: ${fileName}`);
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': contentType || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'no-cache',
          },
          body: buffer.toString('base64'),
          isBase64Encoded: true,
        };
        
      } catch (r2Error) {
        console.error('❌ R2 download failed, falling back to Firebase:', r2Error);
        // Continue to Firebase fallback below
      }
    }
    
    // Firebase Storage proxy fallback (for legacy photos or R2 failures)
    if (url) {
      console.log('⚡ Using Firebase Storage proxy fallback');
      
      try {
        const fetch = require('node-fetch');
        const firebaseResponse = await fetch(url);
        
        if (!firebaseResponse.ok) {
          throw new Error(`Firebase Storage fetch failed: ${firebaseResponse.status}`);
        }
        
        const buffer = await firebaseResponse.buffer();
        console.log('✅ Firebase file fetched, size:', buffer.length);
        
        console.log(`✅ Firebase proxy download initiated for: ${fileName}`);
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': contentType || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'no-cache',
          },
          body: buffer.toString('base64'),
          isBase64Encoded: true,
        };
        
      } catch (error) {
        console.error('❌ Firebase Storage proxy error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Failed to fetch file from Firebase Storage',
            details: error.message
          }),
        };
      }
    } else {
      // No storage available
      console.error('❌ Photo has no R2 key or Firebase URL');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'Photo storage not found',
          details: 'This photo has no R2 key or Firebase Storage URL'
        }),
      };
    }

  } catch (error) {
    console.error('Download error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Download failed',
        details: error.message
      }),
    };
  }
};
