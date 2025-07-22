// Simple download proxy that doesn't require Firebase Admin SDK
exports.handler = async (event) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { url, filename } = event.queryStringParameters || {};

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'URL parameter is required' })
    };
  }

  try {
    console.log('📥 Processing download for:', filename || 'media file');
    
    // Add download parameter to Firebase URL
    const urlObj = new URL(url);
    
    // Set response-content-disposition parameter to force download
    urlObj.searchParams.set('response-content-disposition', `attachment; filename="${filename || 'download'}"`);
    urlObj.searchParams.set('response-content-type', 'application/octet-stream');
    
    const downloadUrl = urlObj.toString();
    console.log('✅ Generated download URL with proper headers');
    
    // Return a redirect to the modified URL
    return {
      statusCode: 302,
      headers: {
        'Location': downloadUrl,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
    
  } catch (error) {
    console.error('❌ Failed to create download URL:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to create download URL',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};
