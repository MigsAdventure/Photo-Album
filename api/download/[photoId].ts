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

// R2 Configuration
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { photoId } = req.query;

    if (!photoId || typeof photoId !== 'string') {
      return res.status(400).json({ error: 'Photo ID is required' });
    }

    // Get photo metadata from Firestore
    const photoDoc = await getDoc(doc(db, 'photos', photoId));
    
    if (!photoDoc.exists()) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photoData = photoDoc.data();
    const { r2Key, fileName, contentType } = photoData;

    if (!r2Key) {
      return res.status(400).json({ error: 'Photo not stored in R2' });
    }

    // Get file from R2
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
    });

    const response = await r2Client.send(getCommand);

    if (!response.Body) {
      return res.status(404).json({ error: 'File not found in storage' });
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    const stream = response.Body as NodeJS.ReadableStream;
    
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    
    const buffer = Buffer.concat(chunks);

    // Set headers for download
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`Download initiated for: ${fileName}`);

    // Send the file
    res.status(200).send(buffer);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      error: 'Download failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
