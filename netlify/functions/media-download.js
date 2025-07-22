const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let app;
const initializeAdmin = () => {
  if (!app) {
    try {
      // Try to get service account from environment variable
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (!serviceAccountJson) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set');
      }
      
      const serviceAccount = JSON.parse(serviceAccountJson);
      
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'wedding-photo-240c9.appspot.com'
      });
      
      console.log('✅ Firebase Admin SDK initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Admin:', error);
      throw error;
    }
  }
  return app;
};

exports.handler = async (event) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { url, filename } = event.queryStringParameters || {};

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'URL parameter is required' })
    };
  }

  try {
    console.log('📥 Creating signed download URL for:', filename || 'media file');
    
    // Initialize admin SDK
    initializeAdmin();
    
    // Extract the storage path from the Firebase URL
    // URLs are in format: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media&token=TOKEN
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/o\/(.+)$/);
    
    if (!pathMatch) {
      throw new Error('Invalid Firebase Storage URL format');
    }
    
    // Decode the path (Firebase encodes slashes as %2F)
    const storagePath = decodeURIComponent(pathMatch[1]);
    console.log('📁 Storage path:', storagePath);
    
    // Get a reference to the file
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      console.error('❌ File not found in storage:', storagePath);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'File not found' })
      };
    }
    
    // Generate a signed URL with download headers
    // The URL will be valid for 1 hour
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour from now
      responseDisposition: `attachment; filename="${filename || 'download'}"`,
      responseType: 'application/octet-stream'
    });
    
    console.log('✅ Signed download URL generated successfully');
    
    // Return a redirect to the signed URL
    return {
      statusCode: 302,
      headers: {
        'Location': signedUrl,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
    
  } catch (error) {
    console.error('❌ Failed to generate signed URL:', error);
    
    // Provide helpful error messages
    let errorMessage = 'Failed to generate download URL';
    
    if (error.message.includes('FIREBASE_SERVICE_ACCOUNT_KEY')) {
      errorMessage = 'Server configuration error. Please contact support.';
    } else if (error.message.includes('permissions')) {
      errorMessage = 'Permission denied. The server lacks necessary permissions.';
    } else if (error.code === 'storage/object-not-found') {
      errorMessage = 'File not found in storage.';
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};
