const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

exports.handler = async (event, context) => {
  console.log('R2 Download Proxy called');
  
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

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Validate environment variables
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      console.error('Missing R2 environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error - missing R2 credentials' }),
      };
    }

    // Get r2Key from query parameters
    const r2Key = event.queryStringParameters?.key;
    const fileName = event.queryStringParameters?.filename || 'download';

    console.log('R2 download requested for key:', r2Key);
    console.log('Filename:', fileName);

    if (!r2Key) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'R2 key is required in query parameter: ?key=r2Key' }),
      };
    }

    // Initialize R2 client
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    console.log('Fetching from R2 bucket:', process.env.R2_BUCKET_NAME, 'key:', r2Key);

    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
    });

    const response = await r2Client.send(getCommand);
    
    if (!response.Body) {
      console.error('No body in R2 response');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'File not found in R2' }),
      };
    }

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    console.log('✅ R2 file loaded, size:', buffer.length);
    console.log('✅ Content-Type:', response.ContentType);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': response.ContentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
    
  } catch (error) {
    console.error('R2 download error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'R2 download failed',
        details: error.message
      }),
    };
  }
};
