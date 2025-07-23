import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { doc, updateDoc } from 'firebase/firestore';
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
  if (req.method !== 'POST') {
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

    const { photoId, firebaseUrl, fileName, eventId, contentType } = req.body;

    if (!photoId || !firebaseUrl || !fileName || !eventId || !contentType) {
      return res.status(400).json({ error: 'Missing required parameters' });
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
    
    const buffer = await response.arrayBuffer();
    console.log(`✅ Downloaded ${buffer.byteLength} bytes from Firebase`);
    
    // 2. Generate R2 key
    const timestamp = Date.now();
    const r2Key = `events/${eventId}/${timestamp}_${fileName}`;
    
    console.log('📤 Uploading to R2 with key:', r2Key);
    
    // 3. Upload to R2
    const putCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      Body: new Uint8Array(buffer),
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
    const docRef = doc(db, 'photos', photoId);
    await updateDoc(docRef, {
      r2Key: r2Key,
      migratedToR2: true,
      r2MigrationDate: new Date(),
      originalFirebaseUrl: firebaseUrl // Keep for backup
    });

    console.log('✅ Updated Firestore with R2 key for photoId:', photoId);
    
    return res.status(200).json({ 
      success: true,
      r2Key: r2Key,
      message: 'R2 copy completed successfully'
    });
    
  } catch (error) {
    console.error('❌ R2 copy failed:', error);
    
    return res.status(500).json({ 
      error: 'R2 copy failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
