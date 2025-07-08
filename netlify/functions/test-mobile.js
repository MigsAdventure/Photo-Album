// Simple test function to verify mobile upload infrastructure
exports.handler = async (event, context) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`=== MOBILE TEST START [${requestId}] ===`);
  
  const userAgent = event.headers['user-agent'] || 'Unknown';
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  
  // Test environment variables
  const envCheck = {
    hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
    hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasR2BucketName: !!process.env.R2_BUCKET_NAME,
    hasR2PublicUrl: !!process.env.R2_PUBLIC_URL,
    hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY,
    hasFirebaseProjectId: !!process.env.REACT_APP_FIREBASE_PROJECT_ID
  };
  
  console.log(`🔧 ENV CHECK [${requestId}]:`, envCheck);
  console.log(`📱 DEVICE INFO [${requestId}]:`, { isMobile, isIOS, isAndroid });
  console.log(`✅ TEST COMPLETED [${requestId}]`);
  
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
      'X-Request-ID': requestId
    },
    body: JSON.stringify({
      success: true,
      requestId,
      deviceInfo: { isMobile, isIOS, isAndroid },
      environmentCheck: envCheck,
      timestamp: new Date().toISOString(),
      message: 'Mobile upload infrastructure test successful'
    })
  };
};
