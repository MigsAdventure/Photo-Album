const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } = require('@aws-sdk/client-s3');
const archiver = require('archiver');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { PassThrough } = require('stream');

// SQS Configuration
const sqs = new SQSClient({ region: 'us-east-1' });
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';

// R2 Configuration (from .env)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: 'https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: '06da59a3b3aa1315ed2c9a38efa7579e',
    secretAccessKey: 'e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27',
  },
  forcePathStyle: true
});

const R2_BUCKET_NAME = 'sharedmoments-photos-production';
const R2_PUBLIC_URL = 'https://sharedmomentsphotos.socialboostai.com';

// Track activity for auto-shutdown
let lastActivity = Date.now();
let isProcessing = false;

// Memory monitoring
function logMemoryUsage(label) {
  const used = process.memoryUsage();
  console.log(`💾 Memory [${label}]: RSS ${(used.rss / 1024 / 1024).toFixed(2)}MB, Heap ${(used.heapUsed / 1024 / 1024).toFixed(2)}MB`);
}

// Auto-shutdown after 10 minutes of inactivity
setInterval(() => {
  if (Date.now() - lastActivity > 600000 && !isProcessing) {
    console.log('🔌 Auto-shutting down due to inactivity (10 min idle)');
    process.exit(0);
  }
}, 60000);

// Main SQS polling function
async function pollForJobs() {
  while (true) {
    try {
      console.log('🔍 Polling SQS queue for jobs...');
      
      const result = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        MessageAttributeNames: ['All']
      }));
      
      if (result.Messages && result.Messages.length > 0) {
        const message = result.Messages[0];
        const jobData = JSON.parse(message.Body);
        
        console.log(`📦 Received job for eventId: ${jobData.eventId} (${jobData.photos?.length || 0} files)`);
        lastActivity = Date.now();
        isProcessing = true;
        
        try {
          await processWeddingJobStreaming(jobData);
          
          // Delete message after successful processing
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          
          console.log(`✅ Job completed: ${jobData.eventId}`);
        } catch (error) {
          console.error(`❌ Processing failed for ${jobData.eventId}:`, error);
          await sendErrorEmail(jobData.email || jobData.customerEmail, jobData.eventId, error.message);
          
          // Delete message to prevent infinite retries
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
        }
        
        isProcessing = false;
        lastActivity = Date.now();
      }
    } catch (error) {
      console.error('❌ Queue polling error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Process wedding photos with streaming
async function processWeddingJobStreaming(jobData) {
  const { eventId, email, photos = [], customerEmail } = jobData;
  const startTime = Date.now();
  
  // Use customerEmail if email is not provided
  const recipientEmail = email || customerEmail;
  
  console.log(`🎥 Processing started (STREAMING MODE): ${eventId}`);
  console.log(`📧 Customer email: ${recipientEmail}`);
  console.log(`📁 Files to process: ${photos.length}`);
  logMemoryUsage('Start');
  
  if (!photos || photos.length === 0) {
    throw new Error('No photos provided for processing');
  }
  
  // Create archive with streaming
  const archive = archiver('zip', { 
    zlib: { level: 6 }, // Balanced compression
    store: false
  });
  
  // Setup archive error handling
  archive.on('error', (err) => {
    console.error('❌ Archive error:', err);
    throw err;
  });
  
  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.warn('⚠️ Archive warning:', err);
    } else {
      throw err;
    }
  });
  
  // Statistics tracking
  let processedFiles = 0;
  let failedFiles = 0;
  let totalBytes = 0;
  const failedFilesList = [];
  
  // Setup multipart upload to R2
  const timestamp = Date.now();
  const r2Key = `downloads/event_${eventId}_photos_${timestamp}.zip`;
  
  console.log(`☁️ Starting multipart upload to R2: ${r2Key}`);
  
  const multipartUpload = await r2Client.send(new CreateMultipartUploadCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    ContentType: 'application/zip',
    Metadata: {
      eventId,
      email: recipientEmail,
      fileCount: photos.length.toString()
    }
  }));
  
  const uploadId = multipartUpload.UploadId;
  const uploadParts = [];
  let partNumber = 1;
  let currentPartBuffer = Buffer.alloc(0);
  const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB minimum part size
  
  // Create a transform stream to collect data and upload in parts
  const uploadStream = new PassThrough();
  const uploadPromises = [];
  
  uploadStream.on('data', (chunk) => {
    currentPartBuffer = Buffer.concat([currentPartBuffer, chunk]);
    
    // Upload when we reach minimum part size
    if (currentPartBuffer.length >= MIN_PART_SIZE) {
      const partData = currentPartBuffer;
      const currentPartNumber = partNumber;
      currentPartBuffer = Buffer.alloc(0);
      partNumber++;
      
      // Upload part asynchronously
      const uploadPromise = (async () => {
        try {
          console.log(`⬆️ Uploading part ${currentPartNumber} (${(partData.length / 1024 / 1024).toFixed(2)}MB)`);
          
          const uploadPartResult = await r2Client.send(new UploadPartCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Key,
            UploadId: uploadId,
            PartNumber: currentPartNumber,
            Body: partData
          }));
          
          uploadParts.push({
            ETag: uploadPartResult.ETag,
            PartNumber: currentPartNumber
          });
          
          logMemoryUsage(`Part ${currentPartNumber} uploaded`);
        } catch (error) {
          console.error(`❌ Failed to upload part ${currentPartNumber}:`, error);
          throw error;
        }
      })();
      
      uploadPromises.push(uploadPromise);
    }
  });
  
  // Pipe archive to upload stream
  archive.pipe(uploadStream);
  
  // Process files one by one (streaming)
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const fileName = photo.fileName || photo.filename || `photo_${i + 1}.jpg`;
    const fileUrl = photo.url || photo.downloadUrl;
    
    try {
      console.log(`⬇️ Streaming ${i + 1}/${photos.length}: ${fileName}`);
      
      // Create a download stream
      const downloadStream = await createDownloadStream(fileUrl);
      
      // Add to archive as stream
      archive.append(downloadStream, { name: fileName });
      
      processedFiles++;
      
      // Log progress every 10 files
      if (processedFiles % 10 === 0) {
        logMemoryUsage(`Processed ${processedFiles} files`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to stream ${fileName}:`, error.message);
      failedFiles++;
      failedFilesList.push({ fileName, error: error.message });
      // Continue with other files
    }
  }
  
  // Finalize the archive
  console.log('🏁 Finalizing ZIP archive...');
  await archive.finalize();
  
  // Wait for stream to finish
  await new Promise((resolve, reject) => {
    uploadStream.on('finish', resolve);
    uploadStream.on('error', reject);
  });
  
  // Wait for all upload promises to complete
  await Promise.all(uploadPromises);
  
  // Upload final part if there's remaining data
  if (currentPartBuffer.length > 0) {
    console.log(`⬆️ Uploading final part ${partNumber} (${(currentPartBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
    
    const uploadPartResult = await r2Client.send(new UploadPartCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: currentPartBuffer
    }));
    
    uploadParts.push({
      ETag: uploadPartResult.ETag,
      PartNumber: partNumber
    });
  }
  
  // Sort parts by part number (required for multipart completion)
  uploadParts.sort((a, b) => a.PartNumber - b.PartNumber);
  
  // Complete multipart upload
  console.log('🏁 Completing multipart upload...');
  await r2Client.send(new CompleteMultipartUploadCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: uploadParts
    }
  }));
  
  const downloadUrl = `${R2_PUBLIC_URL}/${r2Key}`;
  console.log(`✅ Upload complete: ${downloadUrl}`);
  
  // Calculate final stats
  const processingTime = (Date.now() - startTime) / 1000;
  const estimatedZipSize = archive.pointer() / 1024 / 1024; // Archive tracks bytes written
  
  // Send completion email
  await sendCompletionEmail(recipientEmail, eventId, processedFiles, downloadUrl, estimatedZipSize, processingTime, failedFilesList);
  
  console.log(`🎉 Processing complete: ${eventId}`);
  console.log(`📊 Stats: ${processedFiles}/${photos.length} files processed, ${failedFiles} failed`);
  console.log(`📊 Estimated ZIP size: ${estimatedZipSize.toFixed(2)}MB, Time: ${processingTime.toFixed(1)}s`);
  logMemoryUsage('Complete');
}

// Create download stream for a file
function createDownloadStream(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return createDownloadStream(response.headers.location).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      resolve(response);
    }).on('error', reject);
  });
}

// Send completion email
async function sendCompletionEmail(email, eventId, fileCount, downloadUrl, sizeMB, processingTime, failedFiles = []) {
  console.log(`📧 Sending completion email to: ${email}`);
  
  const failedFilesHtml = failedFiles.length > 0 ? `
    <div style="background-color: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p><strong>⚠️ Some files could not be processed:</strong></p>
      <ul style="font-size: 14px; color: #666;">
        ${failedFiles.slice(0, 5).map(f => `<li>${f.fileName}: ${f.error}</li>`).join('')}
        ${failedFiles.length > 5 ? `<li>... and ${failedFiles.length - 5} more files</li>` : ''}
      </ul>
    </div>
  ` : '';
  
  const emailData = {
    to: email,
    subject: 'Your Wedding Photos Are Ready! 🎉',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your Wedding Photos Are Ready!</h2>
        <p>Great news! Your wedding photos for event <strong>${eventId}</strong> have been processed and are ready for download.</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>📊 Processing Summary:</strong></p>
          <ul style="list-style: none; padding: 0;">
            <li>✅ Files processed: ${fileCount}</li>
            <li>📦 ZIP file size: ~${sizeMB.toFixed(2)}MB</li>
            <li>⏱️ Processing time: ${processingTime.toFixed(1)} seconds</li>
            <li>🚀 Method: Streaming (handles large collections)</li>
          </ul>
        </div>
        
        ${failedFilesHtml}
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${downloadUrl}" style="background-color: #4CAF50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-size: 16px;">
            Download Your Photos
          </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">This download link will be available for 7 days. Please save your photos to your device.</p>
        
        ${sizeMB > 1000 ? '<p style="color: #ff6b00; font-size: 14px;"><strong>Note:</strong> This is a large file. We recommend downloading on a stable Wi-Fi connection.</p>' : ''}
      </div>
    `
  };
  
  try {
    const response = await fetch('https://wedding-photo-app.netlify.app/.netlify/functions/direct-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    });
    
    if (response.ok) {
      console.log(`✅ Email sent successfully to: ${email}`);
    } else {
      const error = await response.text();
      console.error(`❌ Email failed (${response.status}): ${error}`);
      throw new Error(`Email service returned ${response.status}`);
    }
  } catch (error) {
    console.error(`❌ Failed to send email:`, error);
    throw error;
  }
}

// Send error email
async function sendErrorEmail(email, eventId, errorMessage) {
  console.log(`📧 Sending error notification to: ${email}`);
  
  const emailData = {
    to: email,
    subject: 'Wedding Photos Processing Failed',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Processing Failed</h2>
        <p>Unfortunately, we encountered an error while processing your wedding photos for event <strong>${eventId}</strong>.</p>
        
        <div style="background-color: #fee; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Error details:</strong></p>
          <p style="color: #c00;">${errorMessage}</p>
        </div>
        
        <p>Our team has been notified and will investigate the issue. You may try uploading your photos again, or contact support if the problem persists.</p>
      </div>
    `
  };
  
  try {
    await fetch('https://wedding-photo-app.netlify.app/.netlify/functions/direct-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    });
  } catch (error) {
    console.error(`❌ Failed to send error email:`, error);
  }
}

// Start processing
console.log('🚀 Wedding Photo Processor Starting (STREAMING VERSION)...');
console.log('🌊 Features: Stream processing, multipart upload, handles 5-10GB+ collections');
console.log('📊 Configuration:');
console.log(`  - R2 Bucket: ${R2_BUCKET_NAME}`);
console.log(`  - R2 Public URL: ${R2_PUBLIC_URL}`);
console.log(`  - SQS Queue: ${queueUrl}`);
console.log(`  - Memory Limit: Minimal (streaming mode)`);
console.log('📬 Starting SQS queue polling...');

pollForJobs().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
