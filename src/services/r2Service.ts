import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
