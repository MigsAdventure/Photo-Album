const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { doc, updateDoc } = require('firebase/firestore');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const fetch = require('node-fetch');

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
  console.log('Netlify R2 copy function called');
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Validate environment variables
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

    const requestBody = JSON.parse(event.body || '{}');
    const { photoId, firebaseUrl, fileName, eventId, contentType } = requestBody;

    if (!photoId || !firebaseUrl || !fileName || !eventId || !contentType) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required parameters' }),
      };
    }

    console.log('📦 Starting R2 copy for:', fileName, 'photo ID:', photoId);

    // Initialize R2 client
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    // 1. Fetch file from Firebase Storage
    console.log('📥 Downloading from Firebase Storage...');
    const response = await fetch(firebaseUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch from Firebase: ${response.status}`);
    }
    
    const buffer = await response.buffer();
    console.log(`✅ Downloaded ${buffer.length} bytes from Firebase`);
    
    // 2. Generate R2 key (new cleaner structure)
    const timestamp = Date.now();
    const r2Key = `media/${eventId}/${timestamp}_${fileName}`;
    
    console.log('📤 Uploading to R2 with key:', r2Key);
    
    // 3. Upload to R2
    const putCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      Body: buffer,
      ContentType: contentType,
      Metadata: {
        'original-filename': fileName,
        'event-id': eventId,
        'photo-id': photoId,
        'migrated-from': 'firebase-storage',
        'migrated-at': new Date().toISOString()
      }
    });
    
    await r2Client.send(putCommand);
    console.log('✅ Successfully uploaded to R2');

    // 4. Update Firestore with R2 key
    console.log('📝 Updating Firestore document for photoId:', photoId);
    try {
      const docRef = doc(db, 'photos', photoId);
      const updateData = {
        r2Key: r2Key,
        migratedToR2: true,
        r2MigrationDate: new Date(),
        originalFirebaseUrl: firebaseUrl // Keep for backup
      };
      
      console.log('📝 Firestore update data:', updateData);
      await updateDoc(docRef, updateData);
      
      console.log('✅ Successfully updated Firestore with R2 key for photoId:', photoId);
      console.log('✅ R2 key saved:', r2Key);
      
    } catch (firestoreError) {
      console.error('❌ Firestore update failed:', firestoreError);
      console.error('❌ Failed to save r2Key to Firestore, but R2 upload succeeded');
      
      // Continue anyway - R2 upload succeeded even if Firestore update failed
      // The server proxy can still serve the file from R2 manually if needed
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        r2Key: r2Key,
        message: 'R2 copy completed successfully'
      }),
    };
    
  } catch (error) {
    console.error('❌ R2 copy failed:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'R2 copy failed',
        details: error.message
      }),
    };
  }
};
