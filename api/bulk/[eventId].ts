import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import archiver from 'archiver';

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
    const { eventId } = req.query;

    if (!eventId || typeof eventId !== 'string') {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    // Get all photos for the event from Firestore
    const photosQuery = query(
      collection(db, 'photos'),
      where('eventId', '==', eventId)
    );
    
    const photosSnapshot = await getDocs(photosQuery);
    
    if (photosSnapshot.empty) {
      return res.status(404).json({ error: 'No photos found for this event' });
    }

    const photos = photosSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Array<{
      id: string;
      r2Key?: string;
      fileName?: string;
      eventId: string;
      [key: string]: any;
    }>;

    console.log(`Creating ZIP for event ${eventId} with ${photos.length} photos`);

    // Set headers for ZIP download
    const zipFileName = `event-${eventId}-photos.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 } // Compression level
    });

    // Handle archive events
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP file' });
      }
    });

    archive.on('warning', (err) => {
      console.warn('Archive warning:', err);
    });

    // Pipe the archive to the response
    archive.pipe(res);

    // Add photos to ZIP
    let addedCount = 0;
    for (const photo of photos) {
      try {
        if (!photo.r2Key) {
          console.warn(`Skipping photo ${photo.id}: no R2 key`);
          continue;
        }

        // Get file from R2
        const getCommand = new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: photo.r2Key,
        });

        const response = await r2Client.send(getCommand);

        if (response.Body) {
          // Convert stream to buffer
          const chunks: Buffer[] = [];
          const stream = response.Body as NodeJS.ReadableStream;
          
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          
          const buffer = Buffer.concat(chunks);

          // Add to ZIP with safe filename
          const safeFileName = photo.fileName || `photo-${addedCount + 1}.jpg`;
          archive.append(buffer, { name: safeFileName });
          addedCount++;
          
          console.log(`Added photo ${addedCount}/${photos.length}: ${safeFileName}`);
        }
      } catch (error) {
        console.error(`Error adding photo ${photo.id} to ZIP:`, error);
        // Continue with other photos
      }
    }

    if (addedCount === 0) {
      archive.destroy();
      return res.status(404).json({ error: 'No photos could be added to ZIP' });
    }

    console.log(`ZIP creation completed for event ${eventId}: ${addedCount} photos added`);

    // Finalize the archive
    await archive.finalize();

  } catch (error) {
    console.error('Bulk download error:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Bulk download failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
