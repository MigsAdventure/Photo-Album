const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, addDoc, collection } = require('firebase/firestore');
const { v4: uuidv4 } = require('uuid');
const busboy = require('busboy');

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase (only if not already initialized)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

exports.handler = async (event, context) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  console.log(`=== UPLOAD FUNCTION START [${requestId}] ===`);
  console.log('Method:', event.httpMethod);
  console.log('Timestamp:', new Date().toISOString());
  console.log('Request ID:', requestId);
  
  // Set timeout handling to prevent silent failures
  context.callbackWaitsForEmptyEventLoop = false;
  
  // Enhanced mobile detection
  const userAgent = event.headers['user-agent'] || event.headers['User-Agent'] || 'Unknown';
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  
  console.log(`=== DEVICE DETECTION [${requestId}] ===`);
  console.log('User-Agent:', userAgent);
  console.log('Is Mobile:', isMobile);
  console.log('Is iOS:', isIOS);
  console.log('Is Android:', isAndroid);
  
  console.log(`=== REQUEST DETAILS [${requestId}] ===`);
  console.log('Content-Type:', event.headers['content-type'] || event.headers['Content-Type']);
  console.log('Content-Length:', event.headers['content-length'] || event.headers['Content-Length']);
  console.log('Body type:', typeof event.body);
  console.log('Body length:', event.body ? event.body.length : 0);
  console.log('Is Base64:', event.isBase64Encoded);
  
  if (isMobile) {
    console.log(`🔍 MOBILE REQUEST DETECTED [${requestId}] - Extra debugging enabled`);
  }

  // Dynamic timeout based on file size and request type
  const contentLength = parseInt(event.headers['content-length'] || event.headers['Content-Length'] || '0');
  const estimatedFileSizeMB = contentLength / (1024 * 1024);
  
  // Base timeout + file size factor, capped at 30 seconds
  const baseTimeout = 8000; // 8 seconds base
  const fileSizeTimeout = Math.min(estimatedFileSizeMB * 2000, 20000); // 2 seconds per MB, max 20s
  const totalTimeout = Math.min(baseTimeout + fileSizeTimeout, 30000); // Cap at 30 seconds
  
  console.log(`⏱️ Backend timeout set to ${totalTimeout}ms (${estimatedFileSizeMB.toFixed(1)}MB file)`);
  
  // Add timeout wrapper to catch silent failures
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      console.error(`❌ FUNCTION TIMEOUT [${requestId}] - Upload exceeded ${totalTimeout}ms`);
      reject(new Error(`Function timeout - upload took too long (${totalTimeout}ms limit)`));
    }, totalTimeout);
  });
  
  // Enhanced CORS headers for mobile compatibility
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, X-Mobile-Request, X-Device-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Max-Age': '86400',
    'X-Request-ID': requestId,
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    console.log(`✅ PREFLIGHT HANDLED [${requestId}]`);
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    console.error(`❌ INVALID METHOD [${requestId}]:`, event.httpMethod);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ 
        error: 'Method not allowed',
        requestId,
        received: event.httpMethod 
      }),
    };
  }

  // Race between upload processing and timeout
  try {
    const result = await Promise.race([
      processUpload(event, context, requestId, headers, isMobile, isIOS, isAndroid),
      timeoutPromise
    ]);
    
    const duration = Date.now() - startTime;
    console.log(`✅ UPLOAD COMPLETED [${requestId}] in ${duration}ms`);
    return result;

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ UPLOAD FAILED [${requestId}] after ${duration}ms:`, {
      message: error.message,
      stack: error.stack,
      isMobile,
      userAgent: userAgent.substring(0, 100) // Truncate for logs
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Upload failed',
        details: error.message,
        requestId,
        duration,
        isMobile,
        timestamp: new Date().toISOString()
      }),
    };
  }
};

// Separate function to handle the actual upload processing
async function processUpload(event, context, requestId, headers, isMobile, isIOS, isAndroid) {
  console.log(`🚀 STARTING UPLOAD PROCESSING [${requestId}]`);
  // Environment check
  console.log(`🔧 ENVIRONMENT CHECK [${requestId}]:`, {
    hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
    hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasR2BucketName: !!process.env.R2_BUCKET_NAME,
    hasR2PublicUrl: !!process.env.R2_PUBLIC_URL,
    hasFirebaseApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY
  });

  // Validate environment variables
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
    console.error(`❌ MISSING R2 ENV VARS [${requestId}]`);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Server configuration error - missing R2 credentials',
        details: 'R2 environment variables not properly configured',
        requestId
      }),
    };
  }

  if (!process.env.REACT_APP_FIREBASE_API_KEY || !process.env.REACT_APP_FIREBASE_PROJECT_ID) {
    console.error(`❌ MISSING FIREBASE ENV VARS [${requestId}]`);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Server configuration error - missing Firebase credentials',
        details: 'Firebase environment variables not properly configured',
        requestId
      }),
    };
  }

  // Initialize R2 client with error handling
  let r2Client;
  try {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      requestHandler: {
        requestTimeout: 10000, // 10 second timeout for R2 operations
      }
    });
    console.log(`✅ R2 CLIENT INITIALIZED [${requestId}]`);
  } catch (error) {
    console.error(`❌ R2 CLIENT INIT FAILED [${requestId}]:`, error);
    throw new Error(`R2 client initialization failed: ${error.message}`);
  }

  // Parse multipart form data using busboy for Netlify
  return new Promise((resolve, reject) => {
    try {
      const contentType = event.headers['content-type'] || event.headers['Content-Type'] || 'multipart/form-data';
      console.log(`📋 SETTING UP BUSBOY [${requestId}] with content-type:`, contentType);
        
      const bb = busboy({ 
        headers: {
          'content-type': contentType
        },
        limits: {
          fileSize: 50 * 1024 * 1024, // 50MB limit for large mobile photos
          files: 1 // Only one file at a time
        }
      });
    
    let fields = {};
    let fileData = null;
    let fileName = '';
    let mimeType = '';

    bb.on('field', (fieldname, value) => {
      console.log(`📝 FIELD RECEIVED [${requestId}]:`, fieldname, '=', value);
      fields[fieldname] = value;
    });

    bb.on('file', (fieldname, file, info) => {
      console.log(`📁 FILE RECEIVED [${requestId}]:`, { fieldname, info });
      const { filename, mimeType: fileMimeType } = info;
      fileName = filename || 'mobile_photo.jpg';
      mimeType = fileMimeType || 'image/jpeg';
      
      console.log(`🔄 PROCESSING FILE [${requestId}]:`, { fileName, mimeType });
        
      const chunks = [];
      let totalSize = 0;
      
      file.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
        if (totalSize % (1024 * 1024) === 0) { // Log every MB
          console.log(`📊 CHUNK PROGRESS [${requestId}]:`, Math.round(totalSize / 1024 / 1024), 'MB');
        }
      });
      
      file.on('end', () => {
        fileData = Buffer.concat(chunks);
        console.log(`✅ FILE PROCESSING COMPLETE [${requestId}] - Final size:`, fileData.length);
      });
      
      file.on('error', (error) => {
        console.error(`❌ FILE STREAM ERROR [${requestId}]:`, error);
      });
    });

    bb.on('close', async () => {
      try {
        console.log(`📋 FORM PARSING COMPLETED [${requestId}]:`, { 
          hasFile: !!fileData, 
          eventId: fields.eventId,
          fileName,
          fileSize: fileData?.length,
          mimeType 
        });

        if (!fileData) {
          console.error(`❌ NO FILE DATA [${requestId}]`);
          resolve({
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'No file uploaded',
              requestId 
            }),
          });
          return;
        }

        if (!fields.eventId) {
          console.error(`❌ NO EVENT ID [${requestId}]`);
          resolve({
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Event ID is required',
              requestId 
            }),
          });
          return;
        }

        // Validate file type
        if (!mimeType.startsWith('image/')) {
          console.error(`❌ INVALID FILE TYPE [${requestId}]:`, mimeType);
          resolve({
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Only image files are allowed',
              received: mimeType,
              requestId 
            }),
          });
          return;
        }

        // Generate unique file key
        const photoId = uuidv4();
        const extension = fileName.split('.').pop() || 'jpg';
        const key = `events/${fields.eventId}/photos/${photoId}.${extension}`;

        console.log(`🚀 UPLOADING TO R2 [${requestId}] with key:`, key);

        // Upload to R2 with enhanced error handling
        try {
          console.log(`☁️ STARTING R2 UPLOAD [${requestId}]`);
          const uploadCommand = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: fileData,
            ContentType: mimeType,
            Metadata: {
              eventId: fields.eventId,
              originalFileName: fileName,
              uploadedAt: new Date().toISOString(),
              requestId: requestId
            }
          });

          const uploadResult = await r2Client.send(uploadCommand);
          console.log(`✅ R2 UPLOAD SUCCESSFUL [${requestId}]:`, uploadResult.ETag);

          // Generate public URL
          const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
          console.log(`🔗 GENERATED PUBLIC URL [${requestId}]:`, publicUrl);

          // Save metadata to Firestore
          console.log(`💾 SAVING TO FIRESTORE [${requestId}]`);
          await addDoc(collection(db, 'photos'), {
            id: photoId,
            url: publicUrl,
            r2Key: key,
            uploadedAt: new Date(),
            eventId: fields.eventId,
            fileName: fileName,
            size: fileData.length,
            contentType: mimeType,
            requestId: requestId
          });

          console.log(`🎉 UPLOAD COMPLETED [${requestId}]: ${fileName} -> ${key}`);

          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              photoId,
              url: publicUrl,
              fileName: fileName,
              size: fileData.length,
              requestId
            }),
          });

        } catch (uploadError) {
          console.error(`❌ UPLOAD/SAVE ERROR [${requestId}]:`, {
            message: uploadError.message,
            stack: uploadError.stack,
            phase: uploadError.message.includes('Firestore') ? 'firestore' : 'r2'
          });
          resolve({
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
              error: 'Upload failed',
              details: uploadError.message,
              requestId
            }),
          });
        }

      } catch (parseError) {
        console.error(`❌ PARSE ERROR [${requestId}]:`, parseError);
        resolve({
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Form processing failed',
            details: parseError.message,
            requestId
          }),
        });
      }
    });

    bb.on('error', (error) => {
      console.error(`❌ BUSBOY ERROR [${requestId}]:`, error);
      
      // Mobile-specific error handling
      if (isMobile) {
        console.error(`📱 MOBILE BUSBOY FAILURE [${requestId}]:`, {
          error: error.message,
          stack: error.stack,
          isIOS,
          isAndroid,
          contentType: event.headers['content-type'] || event.headers['Content-Type'],
          bodyLength: event.body?.length || 0,
          isBase64: event.isBase64Encoded
        });
        
        // Try alternative mobile parsing approach
        if (error.message.includes('Malformed') || error.message.includes('boundary')) {
          console.log(`🔄 ATTEMPTING MOBILE FALLBACK PARSING [${requestId}]`);
          return attemptMobileFallbackParsing(event, requestId, headers, resolve);
        }
      }
      
      resolve({
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Form parsing failed', 
          details: error.message,
          requestId,
          userAgent: event.headers['user-agent'] || 'Unknown',
          mobileDevice: isMobile ? (isIOS ? 'iOS' : isAndroid ? 'Android' : 'Mobile') : 'Desktop'
        }),
      });
    });

    // Write the body data to busboy
    try {
      const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  console.log(`📤 WRITING BODY TO BUSBOY [${requestId}] - Buffer size:`, bodyBuffer.length);
  
  // Enhanced mobile debugging
  if (isMobile) {
    console.log(`📱 MOBILE BUFFER DEBUG [${requestId}]:`, {
      bufferLength: bodyBuffer.length,
      isBase64: event.isBase64Encoded,
      firstBytes: bodyBuffer.slice(0, 100).toString('hex'),
      contentType: event.headers['content-type'] || event.headers['Content-Type'],
      userAgent: (event.headers['user-agent'] || event.headers['User-Agent'] || '').substring(0, 100)
    });
  }
  
  bb.write(bodyBuffer);
  bb.end();
    } catch (bufferError) {
      console.error(`❌ BUFFER ERROR [${requestId}]:`, bufferError);
      resolve({
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to process request body',
          details: bufferError.message,
          requestId,
          userAgent: event.headers['user-agent'] || 'Unknown'
        }),
      });
    }

    } catch (setupError) {
      console.error(`❌ SETUP ERROR [${requestId}]:`, setupError);
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to initialize form parser',
          details: setupError.message,
          requestId,
          userAgent: event.headers['user-agent'] || 'Unknown'
        }),
      });
    }
  });
};

// Mobile fallback parsing for devices that have form encoding issues
async function attemptMobileFallbackParsing(event, requestId, headers, resolve) {
  console.log(`🔄 MOBILE FALLBACK PARSING [${requestId}]`);
  
  try {
    // For mobile devices with encoding issues, try simple buffer extraction
    const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    const bodyString = bodyBuffer.toString();
    
    console.log(`📱 FALLBACK: Analyzing raw body [${requestId}]`, {
      bodyLength: bodyString.length,
      startsWithBoundary: bodyString.includes('boundary='),
      hasFileContent: bodyString.includes('Content-Type: image/')
    });
    
    // Try to extract eventId from form data
    const eventIdMatch = bodyString.match(/name="eventId"[\s\S]*?\r?\n\r?\n(.*?)\r?\n/);
    const eventId = eventIdMatch ? eventIdMatch[1].trim() : null;
    
    if (!eventId) {
      console.error(`❌ FALLBACK: No eventId found [${requestId}]`);
      resolve({
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Mobile fallback parsing failed - no eventId',
          requestId
        }),
      });
      return;
    }
    
    console.log(`✅ FALLBACK: Found eventId [${requestId}]:`, eventId);
    
    // Simple file extraction - look for image data
    const fileStartMatch = bodyString.match(/Content-Type: image\/[^;]+[\s\S]*?\r?\n\r?\n/);
    
    if (!fileStartMatch) {
      console.error(`❌ FALLBACK: No image content found [${requestId}]`);
      resolve({
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Mobile fallback parsing failed - no image content',
          requestId
        }),
      });
      return;
    }
    
    const fileStart = fileStartMatch.index + fileStartMatch[0].length;
    const boundaryMatch = bodyString.match(/------WebKitFormBoundary[A-Za-z0-9]{16}/);
    const boundary = boundaryMatch ? boundaryMatch[0] : null;
    
    if (!boundary) {
      console.error(`❌ FALLBACK: No boundary found [${requestId}]`);
      resolve({
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Mobile fallback parsing failed - no boundary',
          requestId
        }),
      });
      return;
    }
    
    // Find end of file data
    const fileEndIndex = bodyString.indexOf(boundary, fileStart);
    if (fileEndIndex === -1) {
      console.error(`❌ FALLBACK: Could not find file end [${requestId}]`);
      resolve({
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Mobile fallback parsing failed - malformed file data',
          requestId
        }),
      });
      return;
    }
    
    // Extract file data
    const fileDataString = bodyString.substring(fileStart, fileEndIndex - 2); // -2 for \r\n
    const fileBuffer = Buffer.from(fileDataString, 'binary');
    
    console.log(`✅ FALLBACK: Extracted file data [${requestId}]:`, {
      size: fileBuffer.length,
      eventId
    });
    
    // Use extracted data for upload (simplified version)
    // TODO: Continue with R2 upload using extracted data
    resolve({
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Mobile fallback parsing successful',
        size: fileBuffer.length,
        eventId,
        requestId,
        note: 'Simplified mobile upload - full implementation needed'
      }),
    });
    
  } catch (fallbackError) {
    console.error(`❌ FALLBACK ERROR [${requestId}]:`, fallbackError);
    resolve({
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Mobile fallback parsing failed',
        details: fallbackError.message,
        requestId
      }),
    });
  }
}
