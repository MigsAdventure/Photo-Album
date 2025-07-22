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
    console.log('📥 Creating download redirect for:', filename || 'media file');
    
    // Parse the URL to modify it
    const parsedUrl = new URL(url);
    
    // Add response-content-disposition parameter to force download
    // This tells Firebase Storage to set the Content-Disposition header
    const encodedFilename = encodeURIComponent(filename || 'download');
    parsedUrl.searchParams.set('response-content-disposition', `attachment; filename="${encodedFilename}"`);
    
    // Create the modified URL
    const downloadUrl = parsedUrl.toString();
    
    console.log('✅ Redirecting to download URL');
    
    // Return a redirect response
    // This avoids proxying the file through Netlify
    return {
      statusCode: 302,
      headers: {
        'Location': downloadUrl,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
  } catch (error) {
    console.error('❌ Download redirect failed:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create download URL' })
    };
  }
};
