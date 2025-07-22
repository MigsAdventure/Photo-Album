const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const archiver = require('archiver');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');

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
          await processWeddingJob(jobData);
          
          // Delete message after successful processing
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          
          console.log(`✅ Job completed: ${jobData.eventId}`);
        } catch (error) {
          console.error(`❌ Processing failed for ${jobData.eventId}:`, error);
          await sendErrorEmail(jobData.email, jobData.eventId, error.message);
          
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

// Process wedding photos
async function processWeddingJob(jobData) {
  const { eventId, email, photos = [], customerEmail } = jobData;
  const startTime = Date.now();
  
  // Use customerEmail if email is not provided
  const recipientEmail = email || customerEmail;
  
  console.log(`🎥 Processing started: ${eventId}`);
  console.log(`📧 Customer email: ${recipientEmail}`);
  console.log(`📁 Files to process: ${photos.length}`);
  
  if (!photos || photos.length === 0) {
    throw new Error('No photos provided for processing');
  }
  
  const tempDir = `/tmp/${eventId}`;
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const downloadedFiles = [];
  let totalBytes = 0;
  
  // Download all files
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const fileName = photo.fileName || photo.filename || `photo_${i + 1}.jpg`;
    const fileUrl = photo.url || photo.downloadUrl;
    
    try {
      console.log(`⬇️ Downloading ${i + 1}/${photos.length}: ${fileName}`);
      
      const filePath = path.join(tempDir, fileName);
      const fileSize = await downloadFile(fileUrl, filePath);
      
      downloadedFiles.push({
        path: filePath,
        name: fileName,
        size: fileSize
      });
      
      totalBytes += fileSize;
      console.log(`✅ Downloaded: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
    } catch (error) {
      console.error(`❌ Failed to download ${fileName}:`, error.message);
      // Continue with other files
    }
  }
  
  if (downloadedFiles.length === 0) {
    throw new Error('Failed to download any files');
  }
  
  console.log(`📊 Downloaded ${downloadedFiles.length}/${photos.length} files (${(totalBytes / 1024 / 1024).toFixed(2)}MB total)`);
  
  // Create ZIP archive
  const zipPath = path.join(tempDir, `${eventId}.zip`);
  await createZipArchive(downloadedFiles, zipPath);
  
  const zipStats = fs.statSync(zipPath);
  const zipSizeMB = zipStats.size / 1024 / 1024;
  
  console.log(`🗜️ ZIP created: ${zipSizeMB.toFixed(2)}MB`);
  
  // Upload to R2
  const timestamp = Date.now();
  const r2Key = `downloads/event_${eventId}_photos_${timestamp}.zip`;
  
  console.log(`☁️ Uploading to R2: ${r2Key}`);
  
  const zipBuffer = fs.readFileSync(zipPath);
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    Body: zipBuffer,
    ContentType: 'application/zip',
    Metadata: {
      eventId,
      email: recipientEmail,
      fileCount: downloadedFiles.length.toString(),
      originalFileCount: photos.length.toString()
    }
  }));
  
  const downloadUrl = `${R2_PUBLIC_URL}/${r2Key}`;
  console.log(`✅ Uploaded to R2: ${downloadUrl}`);
  
  // Clean up temp files
  fs.rmSync(tempDir, { recursive: true, force: true });
  
  // Send completion email via Netlify function
  const processingTime = (Date.now() - startTime) / 1000;
  await sendCompletionEmail(recipientEmail, eventId, downloadedFiles.length, downloadUrl, zipSizeMB, processingTime);
  
  console.log(`🎉 Processing complete: ${eventId}`);
  console.log(`📊 Stats: ${downloadedFiles.length}/${photos.length} files, ${zipSizeMB.toFixed(2)}MB, ${processingTime.toFixed(1)}s`);
}

// Download file helper
async function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(filePath);
        return downloadFile(response.headers.location, filePath).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filePath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve(downloadedBytes);
      });
      
      file.on('error', (err) => {
        fs.unlinkSync(filePath);
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlinkSync(filePath);
      reject(err);
    });
  });
}

// Create ZIP archive
async function createZipArchive(files, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    
    output.on('close', () => resolve());
    archive.on('error', reject);
    
    archive.pipe(output);
    
    files.forEach(file => {
      archive.file(file.path, { name: file.name });
    });
    
    archive.finalize();
  });
}

// Send completion email
async function sendCompletionEmail(email, eventId, fileCount, downloadUrl, sizeMB, processingTime) {
  console.log(`📧 Sending completion email to: ${email}`);
  
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
            <li>📦 ZIP file size: ${sizeMB.toFixed(2)}MB</li>
            <li>⏱️ Processing time: ${processingTime.toFixed(1)} seconds</li>
          </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${downloadUrl}" style="background-color: #4CAF50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-size: 16px;">
            Download Your Photos
          </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">This download link will be available for 7 days. Please save your photos to your device.</p>
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
console.log('🚀 Wedding Photo Processor Starting...');
console.log('📊 Configuration:');
console.log(`  - R2 Bucket: ${R2_BUCKET_NAME}`);
console.log(`  - R2 Public URL: ${R2_PUBLIC_URL}`);
console.log(`  - SQS Queue: ${queueUrl}`);
console.log('📬 Starting SQS queue polling...');

pollForJobs().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
