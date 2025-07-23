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
        const chunks: Buffer[] = [];
        const stream = response.Body as NodeJS.ReadableStream;
        
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        
        const buffer = Buffer.concat(chunks);
        console.log('✅ R2 file loaded, size:', buffer.length);

        // Set headers for download
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'no-cache');

        console.log(`✅ R2 download initiated for: ${fileName}`);
        return res.status(200).send(buffer);
        
      } catch (r2Error) {
        console.error('❌ R2 download failed, falling back to Firebase:', r2Error);
        // Continue to Firebase fallback below
      }
    }
    
    // Firebase Storage proxy fallback (for legacy photos or R2 failures)
    if (url) {
      console.log('⚡ Using Firebase Storage proxy fallback');
      
      try {
        const firebaseResponse = await fetch(url);
        
        if (!firebaseResponse.ok) {
          throw new Error(`Firebase Storage fetch failed: ${firebaseResponse.status}`);
        }
        
        const buffer = Buffer.from(await firebaseResponse.arrayBuffer());
        console.log('✅ Firebase file fetched, size:', buffer.length);
        
        // Set proper download headers
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'no-cache');
        
        console.log(`✅ Firebase proxy download initiated for: ${fileName}`);
        return res.status(200).send(buffer);
        
      } catch (error) {
        console.error('❌ Firebase Storage proxy error:', error);
        return res.status(500).json({ 
          error: 'Failed to fetch file from Firebase Storage',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } else {
      // No storage available
      console.error('❌ Photo has no R2 key or Firebase URL');
      return res.status(404).json({ 
        error: 'Photo storage not found',
        details: 'This photo has no R2 key or Firebase Storage URL'
      });
    }

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
