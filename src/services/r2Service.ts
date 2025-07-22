import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

// R2 client configuration
const createR2Client = () => {
  if (!process.env.REACT_APP_R2_ACCOUNT_ID || 
      !process.env.REACT_APP_R2_ACCESS_KEY_ID || 
      !process.env.REACT_APP_R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 environment variables not configured');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.REACT_APP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.REACT_APP_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_R2_SECRET_ACCESS_KEY,
    },
  });
};

// Copy a file from Firebase Storage to R2
export const copyFirebaseToR2 = async (
  firebaseUrl: string,
  fileName: string,
  eventId: string,
  contentType: string
): Promise<string> => {
  try {
    console.log('📦 Starting Firebase → R2 copy for:', fileName);
    
    // 1. Fetch file from Firebase Storage
    console.log('📥 Downloading from Firebase Storage...');
    const response = await fetch(firebaseUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch from Firebase: ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    console.log(`✅ Downloaded ${buffer.byteLength} bytes from Firebase`);
    
    // 2. Generate R2 key
    const extension = fileName.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const r2Key = `events/${eventId}/${timestamp}_${fileName}`;
    
    console.log('📤 Uploading to R2 with key:', r2Key);
    
    // 3. Upload to R2
    const r2Client = createR2Client();
    const putCommand = new PutObjectCommand({
      Bucket: process.env.REACT_APP_R2_BUCKET_NAME,
      Key: r2Key,
      Body: new Uint8Array(buffer),
      ContentType: contentType,
      Metadata: {
        'original-filename': fileName,
        'event-id': eventId,
        'migrated-from': 'firebase-storage',
        'migrated-at': new Date().toISOString()
      }
    });
    
    await r2Client.send(putCommand);
    console.log('✅ Successfully uploaded to R2');
    
    return r2Key;
    
  } catch (error) {
    console.error('❌ Firebase → R2 copy failed:', error);
    throw error;
  }
};

// Copy a photo and update Firestore with R2 key
export const migratePhotoToR2 = async (photoId: string, photoData: any): Promise<void> => {
  try {
    console.log('🔄 Migrating photo to R2:', photoId);
    
    // Skip if already has R2 key
    if (photoData.r2Key) {
      console.log('⏭️ Photo already has R2 key, skipping:', photoId);
      return;
    }
    
    // Copy to R2
    const r2Key = await copyFirebaseToR2(
      photoData.url,
      photoData.fileName || `photo_${photoId}`,
      photoData.eventId,
      photoData.contentType || 'image/jpeg'
    );
    
    // Update Firestore with R2 key
    const docRef = doc(db, 'photos', photoId);
    await updateDoc(docRef, {
      r2Key: r2Key,
      migratedToR2: true,
      r2MigrationDate: new Date(),
      originalFirebaseUrl: photoData.url // Keep for backup
    });
    
    console.log('✅ Photo migration completed:', photoId, '→', r2Key);
    
  } catch (error) {
    console.error('❌ Photo migration failed for', photoId, ':', error);
    // Don't throw - we want to continue with other photos
  }
};

// Batch migrate multiple photos
export const migrateBatchToR2 = async (photos: any[]): Promise<{ success: number; failed: number }> => {
  console.log(`🚀 Starting batch migration of ${photos.length} photos to R2`);
  
  let success = 0;
  let failed = 0;
  
  for (const photo of photos) {
    try {
      await migratePhotoToR2(photo.id, photo);
      success++;
      
      // Small delay to avoid overwhelming the services
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error('❌ Failed to migrate photo:', photo.id, error);
      failed++;
    }
  }
  
  console.log(`✅ Batch migration completed: ${success} success, ${failed} failed`);
  return { success, failed };
};

// Test R2 connectivity
export const testR2Connection = async (): Promise<boolean> => {
  try {
    console.log('🧪 Testing R2 connection...');
    
    const r2Client = createR2Client();
    const testKey = `test/connection-test-${Date.now()}.txt`;
    
    // Upload a test file
    const putCommand = new PutObjectCommand({
      Bucket: process.env.REACT_APP_R2_BUCKET_NAME,
      Key: testKey,
      Body: new TextEncoder().encode('R2 connection test'),
      ContentType: 'text/plain'
    });
    
    await r2Client.send(putCommand);
    console.log('✅ R2 connection test successful');
    return true;
    
  } catch (error) {
    console.error('❌ R2 connection test failed:', error);
    return false;
  }
};
