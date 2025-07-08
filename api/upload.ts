import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { addDoc, collection } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';

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

// R2 client will be initialized inside the handler

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Helper to run multer middleware
function runMiddleware(req: any, res: any, fn: any) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Upload API called with method:', req.method);
  console.log('Environment check:', {
    hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
    hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasR2BucketName: !!process.env.R2_BUCKET_NAME,
    hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY
  });

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

    if (!process.env.REACT_APP_FIREBASE_API_KEY || !process.env.REACT_APP_FIREBASE_PROJECT_ID) {
      console.error('Missing Firebase environment variables');
      return res.status(500).json({ 
        error: 'Server configuration error - missing Firebase credentials',
        details: 'Firebase environment variables not properly configured'
      });
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

    // Run multer middleware
    console.log('Running multer middleware...');
    await runMiddleware(req, res, upload.single('photo'));

    const file = (req as any).file;
    const { eventId } = req.body;

    console.log('File received:', { 
      hasFile: !!file, 
      eventId,
      fileName: file?.originalname,
      size: file?.size 
    });

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    // Generate unique file key
    const photoId = uuidv4();
    const extension = file.originalname.split('.').pop();
    const key = `events/${eventId}/photos/${photoId}.${extension}`;

    console.log('Uploading to R2 with key:', key);

    // Upload to R2
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        eventId,
        originalFileName: file.originalname,
        uploadedAt: new Date().toISOString(),
      }
    });

    await r2Client.send(uploadCommand);
    console.log('R2 upload successful');

    // Generate public URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

    // Save metadata to Firestore
    await addDoc(collection(db, 'photos'), {
      id: photoId,
      url: publicUrl,
      r2Key: key,
      uploadedAt: new Date(),
      eventId,
      fileName: file.originalname,
      size: file.size,
      contentType: file.mimetype
    });

    console.log(`Photo uploaded successfully: ${file.originalname} -> ${key}`);

    res.status(200).json({
      success: true,
      photoId,
      url: publicUrl,
      fileName: file.originalname,
      size: file.size
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Disable body parser for multer
export const config = {
  api: {
    bodyParser: false,
  },
};
