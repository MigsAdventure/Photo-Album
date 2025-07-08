import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { doc, getDoc } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Download API called with method:', req.method);
  console.log('Environment check:', {
    hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
    hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasR2BucketName: !!process.env.R2_BUCKET_NAME,
    hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY
  });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate environment variables
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      console.error('Missing R2 environment variables');
      return res.status(500).json({ 
        error: 'Server configuration error - missing R2 credentials',
        details: 'R2 environment variables not properly configured'
      });
    }

    if (!process.env.REACT_APP_FIREBASE_API_KEY || !process.env.REACT_APP_FIREBASE_PROJECT_ID) {
      console.error('Missing Firebase environment variables');
      return res.status(500).json({ 
        error: 'Server configuration error - missing Firebase credentials',
        details: 'Firebase environment variables not properly configured'
      });
    }

    const { photoId } = req.query;
    console.log('Downloading photo ID:', photoId);

    if (!photoId || typeof photoId !== 'string') {
      return res.status(400).json({ error: 'Photo ID is required' });
    }

    // Initialize R2 client inside handler
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    console.log('R2 client initialized successfully');

    // Get photo metadata from Firestore
    console.log('Fetching photo metadata from Firestore...');
    const photoDoc = await getDoc(doc(db, 'photos', photoId));
    
    if (!photoDoc.exists()) {
      console.log('Photo not found in Firestore');
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photoData = photoDoc.data();
    console.log('Photo data:', { 
      hasR2Key: !!photoData.r2Key, 
      fileName: photoData.fileName,
      contentType: photoData.contentType 
    });

    const { r2Key, fileName, contentType } = photoData;

    if (!r2Key) {
      console.log('Photo does not have R2 key - might be Firebase Storage photo');
      return res.status(400).json({ 
        error: 'Photo not stored in R2',
        details: 'This photo was uploaded to Firebase Storage and cannot be downloaded via this endpoint'
      });
    }

    // Get file from R2
    console.log('Fetching file from R2 with key:', r2Key);
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
    });

    const response = await r2Client.send(getCommand);
    console.log('R2 response received, has body:', !!response.Body);

    if (!response.Body) {
      console.log('No body in R2 response');
      return res.status(404).json({ error: 'File not found in storage' });
    }

    // Convert stream to buffer
    console.log('Converting stream to buffer...');
    const chunks: Buffer[] = [];
    const stream = response.Body as NodeJS.ReadableStream;
    
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    
    const buffer = Buffer.concat(chunks);
    console.log('Buffer created, size:', buffer.length);

    // Set headers for download
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`Download initiated for: ${fileName}`);

    // Send the file
    res.status(200).send(buffer);

  } catch (error) {
    console.error('Download error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    
    res.status(500).json({ 
      error: 'Download failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
