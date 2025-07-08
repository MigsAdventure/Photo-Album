import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Basic test API called');
  
  try {
    // Just test environment variables without any imports
    const envCheck = {
      hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
      hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
      hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
      hasR2BucketName: !!process.env.R2_BUCKET_NAME,
      nodeVersion: process.version,
      timestamp: new Date().toISOString()
    };

    console.log('Environment check:', envCheck);

    res.status(200).json({
      success: true,
      message: 'Basic test passed - no AWS SDK imports',
      envCheck,
      method: req.method,
      headers: req.headers['content-type']
    });

  } catch (error) {
    console.error('Basic test error:', error);
    res.status(500).json({ 
      error: 'Basic test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
