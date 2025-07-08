exports.handler = async (event, context) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  
  console.log(`=== UPLOAD FIX TEST [${requestId}] ===`);
  
  // Test busboy import
  try {
    const busboy = require('busboy');
    console.log(`✅ BUSBOY IMPORT SUCCESS [${requestId}]`);
  } catch (error) {
    console.error(`❌ BUSBOY IMPORT FAILED [${requestId}]:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Busboy import failed',
        details: error.message,
        requestId
      }),
    };
  }
  
  // Test AWS SDK import
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    console.log(`✅ AWS SDK IMPORT SUCCESS [${requestId}]`);
  } catch (error) {
    console.error(`❌ AWS SDK IMPORT FAILED [${requestId}]:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'AWS SDK import failed',
        details: error.message,
        requestId
      }),
    };
  }
  
  // Test environment variables
  const envCheck = {
    hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
    hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasR2BucketName: !!process.env.R2_BUCKET_NAME,
    hasR2PublicUrl: !!process.env.R2_PUBLIC_URL,
    hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY
  };
  
  console.log(`🔧 ENVIRONMENT CHECK [${requestId}]:`, envCheck);
  
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      success: true,
      message: 'Upload function dependencies are working correctly',
      requestId,
      environmentCheck: envCheck,
      timestamp: new Date().toISOString()
    }),
  };
};
