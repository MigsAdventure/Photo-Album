const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, addDoc, collection } = require('firebase/firestore');
const { v4: uuidv4 } = require('uuid');
const multiparty = require('multiparty');

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
  console.log('Netlify upload function called');
  console.log('Method:', event.httpMethod);
  
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
    // Environment check
    console.log('Environment check:', {
      hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
      hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
      hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
      hasR2BucketName: !!process.env.R2_BUCKET_NAME,
      hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY
    });

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

    // Initialize R2 client
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    console.log('R2 client initialized successfully');

    // Parse multipart form data using busboy for Netlify
    const busboy = require('busboy');
    
    return new Promise((resolve, reject) => {
      const bb = busboy({ 
        headers: {
          'content-type': event.headers['content-type'] || event.headers['Content-Type']
        }
      });
      
      let fields = {};
      let fileData = null;
      let fileName = '';
      let mimeType = '';

      bb.on('field', (fieldname, value) => {
        fields[fieldname] = value;
      });

      bb.on('file', (fieldname, file, info) => {
        const { filename, mimeType: fileMimeType } = info;
        fileName = filename || 'image.jpg';
        mimeType = fileMimeType || 'image/jpeg';
        
        const chunks = [];
        file.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        file.on('end', () => {
          fileData = Buffer.concat(chunks);
        });
      });

      bb.on('close', async () => {
        try {
          console.log('Form parsing completed:', { 
            hasFile: !!fileData, 
            eventId: fields.eventId,
            fileName,
            fileSize: fileData?.length 
          });

          if (!fileData) {
            resolve({
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'No file uploaded' }),
            });
            return;
          }

          if (!fields.eventId) {
            resolve({
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'Event ID is required' }),
            });
            return;
          }

          // Validate file type
          if (!mimeType.startsWith('image/')) {
            resolve({
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'Only image files are allowed' }),
            });
            return;
          }

          // Generate unique file key
          const photoId = uuidv4();
          const extension = fileName.split('.').pop() || 'jpg';
          const key = `events/${fields.eventId}/photos/${photoId}.${extension}`;

          console.log('Uploading to R2 with key:', key);

          // Upload to R2
          const uploadCommand = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: fileData,
            ContentType: mimeType,
            Metadata: {
              eventId: fields.eventId,
              originalFileName: fileName,
              uploadedAt: new Date().toISOString(),
            }
          });

          const uploadResult = await r2Client.send(uploadCommand);
          console.log('R2 upload successful');

          // Generate public URL
          const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

          // Save metadata to Firestore
          await addDoc(collection(db, 'photos'), {
            id: photoId,
            url: publicUrl,
            r2Key: key,
            uploadedAt: new Date(),
            eventId: fields.eventId,
            fileName: fileName,
            size: fileData.length,
            contentType: mimeType
          });

          console.log(`Photo uploaded successfully: ${fileName} -> ${key}`);

          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              photoId,
              url: publicUrl,
              fileName: fileName,
              size: fileData.length
            }),
          });

        } catch (error) {
          console.error('Upload error:', error);
          resolve({
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
              error: 'Upload failed',
              details: error.message
            }),
          });
        }
      });

      // Write the body data to busboy
      const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
      bb.write(bodyBuffer);
      bb.end();
    });

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Function failed',
        details: error.message
      }),
    };
  }
};
