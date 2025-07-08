exports.handler = async (event, context) => {
  console.log('Netlify test function called');
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // Environment check
    const envCheck = {
      hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
      hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
      hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
      hasR2BucketName: !!process.env.R2_BUCKET_NAME,
      hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY,
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString()
    };

    console.log('Environment check:', envCheck);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Netlify function working perfectly! 🎉',
        envCheck,
        method: event.httpMethod,
        path: event.path,
        userAgent: event.headers['user-agent'] || 'Unknown'
      }),
    };

  } catch (error) {
    console.error('Test function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Test function failed',
        details: error.message
      }),
    };
  }
};
