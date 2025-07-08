import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('R2 Test API called');
  
  try {
    // Check environment variables first
    const envCheck = {
      hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
      hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
      hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
      hasR2BucketName: !!process.env.R2_BUCKET_NAME,
      accountId: process.env.R2_ACCOUNT_ID ? 'exists' : 'missing',
      bucketName: process.env.R2_BUCKET_NAME ? 'exists' : 'missing'
    };

    console.log('Environment check:', envCheck);

    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      return res.status(500).json({ 
        error: 'Missing R2 environment variables',
        envCheck
      });
    }

    // Test R2 connection
    console.log('Testing R2 connection...');
    
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    // Try to list objects (simple test)
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      MaxKeys: 1, // Just test connection
    });

    const listResult = await r2Client.send(listCommand);
    
    console.log('R2 connection successful');

    res.status(200).json({
      success: true,
      message: 'R2 connection test passed',
      envCheck,
      r2Test: {
        connected: true,
        objectCount: listResult.KeyCount || 0,
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        bucket: process.env.R2_BUCKET_NAME
      }
    });

  } catch (error) {
    console.error('R2 test error:', error);
    res.status(500).json({ 
      error: 'R2 test failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
