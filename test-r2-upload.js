const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function testR2Upload() {
  console.log('Testing R2 upload...');
  
  // Check environment variables
  console.log('Environment check:', {
    hasR2AccountId: !!process.env.R2_ACCOUNT_ID,
    hasR2AccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasR2SecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasR2BucketName: !!process.env.R2_BUCKET_NAME,
    accountId: process.env.R2_ACCOUNT_ID,
    bucketName: process.env.R2_BUCKET_NAME
  });

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
    console.error('Missing R2 environment variables');
    return;
  }

  try {
    // Initialize R2 client
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    console.log('R2 client initialized successfully');

    // Create a test text file to upload
    const testContent = `R2 Upload Test
Timestamp: ${new Date().toISOString()}
Test Event ID: test-event-123
This is a test upload to verify R2 connection works.`;

    const testEventId = 'test-event-123';
    const testFileName = `test-upload-${Date.now()}.txt`;
    const key = `events/${testEventId}/photos/${testFileName}`;

    console.log('Uploading test file with key:', key);

    // Upload to R2
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: Buffer.from(testContent),
      ContentType: 'text/plain',
      Metadata: {
        eventId: testEventId,
        originalFileName: testFileName,
        uploadedAt: new Date().toISOString(),
        testUpload: 'true'
      }
    });

    const result = await r2Client.send(uploadCommand);
    
    console.log('✅ R2 upload successful!');
    console.log('Upload result:', result);
    
    // Generate public URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    console.log('📎 Public URL:', publicUrl);
    
    console.log('\n🎉 R2 test completed successfully!');
    console.log('You can check your R2 dashboard to see the uploaded file.');

  } catch (error) {
    console.error('❌ R2 upload failed:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
}

testR2Upload();
