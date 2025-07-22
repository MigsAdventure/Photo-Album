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
    console.log('📥 Proxying download for:', filename || 'media file');
    
    // Fetch the media from Firebase Storage
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status}`);
    }

    // Get the content type from the response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    // Convert the response to a buffer
    const buffer = await response.arrayBuffer();
    
    // Set headers to force download
    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename || 'download'}"`,
      'Cache-Control': 'no-cache'
    };

    console.log('✅ Download proxy successful');
    
    return {
      statusCode: 200,
      headers,
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('❌ Download proxy failed:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to download media' })
    };
  }
};
