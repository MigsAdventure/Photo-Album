const AWS = require('aws-sdk');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fetch = require('node-fetch');
const archiver = require('archiver');
const stream = require('stream');
const util = require('util');

// Configure AWS
const sqs = new AWS.SQS({ region: 'us-east-1' });
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';

// Auto-termination settings
let lastActivity = Date.now();
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
let isProcessing = false;

// Configure R2 client with better SSL settings
const r2Client = new S3Client({
  region: 'auto',
  endpoint: 'https://782720046962.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestHandler: {
    requestTimeout: 300000, // 5 minutes
    connectionTimeout: 60000, // 1 minute
  },
  retryMode: 'adaptive',
  maxAttempts: 5
});

// File size threshold (400MB)
const MAX_FILE_SIZE = 400 * 1024 * 1024;

async function sendErrorEmail(email, eventId, error) {
  try {
    const response = await fetch('https://wedding-photo-app.netlify.app/.netlify/functions/direct-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: 'Wedding Photos Processing Failed',
        html: `
          <h2>Processing Failed</h2>
          <p>Your wedding photos for event <strong>${eventId}</strong> failed to process.</p>
          <p><strong>Error:</strong> ${error}</p>
          <p>Our team has been notified and will process your photos manually.</p>
        `
      })
    });
    
    if (response.ok) {
      console.log(`✅ Error notification sent to: ${email}`);
    } else {
      console.log(`❌ Failed to send error notification: ${response.status}`);
    }
  } catch (err) {
    console.log(`❌ Failed to send error notification: ${err.message}`);
  }
}

async function sendSuccessEmail(email, eventId, downloadUrl) {
  try {
    const response = await fetch('https://wedding-photo-app.netlify.app/.netlify/functions/direct-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: 'Your Wedding Photos Are Ready!',
        html: `
          <h2>Your Wedding Photos Are Ready!</h2>
          <p>Your wedding photos for event <strong>${eventId}</strong> have been processed and are ready for download!</p>
          <p><a href="${downloadUrl}" style="background-color: #4CAF50; color: white; padding: 14px 20px; text-decoration: none; border-radius: 4px;">Download Your Photos</a></p>
          <p>This download link will be available for 7 days.</p>
        `
      })
    });
    
    if (response.ok) {
      console.log(`✅ Success notification sent to: ${email}`);
    } else {
      console.log(`❌ Failed to send success notification: ${response.status}`);
    }
  } catch (err) {
    console.log(`❌ Failed to send success notification: ${err.message}`);
  }
}

async function downloadFile(url, maxSize = MAX_FILE_SIZE) {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(res => {
        const contentLength = parseInt(res.headers.get('content-length') || '0');
        
        if (contentLength > maxSize) {
          reject(new Error(`File too large: ${Math.round(contentLength/1024/1024)}MB (max: ${Math.round(maxSize/1024/1024)}MB)`));
          return;
        }

        if (!res.ok) {
          reject(new Error(`HTTP ${res.status}: ${res.statusText}`));
          return;
        }

        const chunks = [];
        let downloadedBytes = 0;

        res.body.on('data', (chunk) => {
          chunks.push(chunk);
          downloadedBytes += chunk.length;
          
          if (downloadedBytes > maxSize) {
            reject(new Error(`File too large during download: ${Math.round(downloadedBytes/1024/1024)}MB`));
            return;
          }
          
          // Progress logging every 10MB
          if (downloadedBytes % (10 * 1024 * 1024) < chunk.length) {
            console.log(`📊 Progress: ${Math.round((downloadedBytes / contentLength) * 100)}% (${Math.round(downloadedBytes/1024/1024)}MB/${Math.round(contentLength/1024/1024)}MB)`);
          }
        });

        res.body.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        res.body.on('error', reject);
      })
      .catch(reject);
  });
}

async function createZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 1 } }); // Fastest compression
    const buffers = [];
    
    archive.on('data', (chunk) => buffers.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(buffers)));
    archive.on('error', reject);

    files.forEach((file, index) => {
      archive.append(file.buffer, { name: file.name });
      console.log(`✅ Added ${index + 1}/${files.length}: ${file.name} (${(file.buffer.length / 1024 / 1024).toFixed(2)}MB)`);
    });

    archive.finalize();
  });
}

async function uploadToR2(buffer, key) {
  const fileSizeMB = buffer.length / 1024 / 1024;
  console.log(`☁️ Uploading to R2: ${key} (${fileSizeMB.toFixed(2)}MB)`);

  try {
    await r2Client.send(new PutObjectCommand({
      Bucket: 'wedding-photos',
      Key: key,
      Body: buffer,
      ContentType: 'application/zip',
      ContentLength: buffer.length,
    }));

    const downloadUrl = `https://pub-4050c6ad131240bb9c0dd5df1b41c53b.r2.dev/${key}`;
    console.log(`🎉 Successfully uploaded to R2: ${downloadUrl}`);
    return downloadUrl;
  } catch (error) {
    console.error('❌ R2 upload failed:', error);
    throw error;
  }
}

async function processMessage(message) {
  const messageData = JSON.parse(message.Body);
  const { eventId, email, photos } = messageData;
  const customerEmail = email || messageData.customerEmail; // Handle both formats
  const files = photos || messageData.files || []; // Handle both formats
  
  console.log(`🎥 REAL PROCESSING STARTED: ${eventId}`);
  console.log(`📧 Customer email: ${customerEmail}`);
  console.log(`📁 Files to process: ${files.length}`);

  try {
    // Calculate total expected size
    let estimatedSize = 0;
    for (const file of files) {
      try {
        // Handle different URL field names
        const fileUrl = file.url || file.downloadUrl || file.downloadURL;
        const headResponse = await fetch(fileUrl, { method: 'HEAD' });
        const size = parseInt(headResponse.headers.get('content-length') || file.size || '0');
        estimatedSize += size;
      } catch (err) {
        const fileName = file.fileName || file.filename || 'unknown';
        console.log(`⚠️ Could not get size for ${fileName}, continuing...`);
      }
    }

    const estimatedSizeMB = estimatedSize / 1024 / 1024;
    console.log(`📊 Estimated total size: ${estimatedSizeMB.toFixed(2)}MB`);

    // Check if total size exceeds limit
    if (estimatedSize > MAX_FILE_SIZE) {
      throw new Error(`Archive too large: ${estimatedSizeMB.toFixed(2)}MB (max: ${MAX_FILE_SIZE / 1024 / 1024}MB). Please contact support for large file processing.`);
    }

    console.log(`📦 Creating ZIP archive for ${files.length} files...`);
    
    const downloadedFiles = [];
    
    // Download files with size checking
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.fileName || file.filename || `file_${i + 1}`;
      const fileUrl = file.url || file.downloadUrl || file.downloadURL;
      
      console.log(`⬇️ Downloading ${i + 1}/${files.length}: ${fileName}`);
      console.log(`📥 Downloading: ${fileUrl.substring(0, 100)}...`);
      
      try {
        const buffer = await downloadFile(fileUrl);
        downloadedFiles.push({
          name: fileName,
          buffer: buffer
        });
        console.log(`✅ Download complete: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
      } catch (error) {
        if (error.message.includes('File too large')) {
          console.log(`⚠️ Skipping large file: ${fileName} - ${error.message}`);
          continue; // Skip large files instead of failing entire job
        }
        throw error;
      }
    }

    if (downloadedFiles.length === 0) {
      throw new Error('No files could be processed (all files too large)');
    }

    const totalSize = downloadedFiles.reduce((sum, f) => sum + f.buffer.length, 0);
    console.log(`📊 Downloaded ${downloadedFiles.length}/${files.length} files (${(totalSize / 1024 / 1024).toFixed(2)}MB total)`);

    // Create ZIP
    console.log(`🗜️ Creating ZIP archive...`);
    const zipBuffer = await createZipBuffer(downloadedFiles);
    console.log(`🗜️ ZIP archive created: ${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Upload to R2
    const timestamp = Date.now();
    const zipKey = `downloads/event_${eventId}_photos_${timestamp}.zip`;
    const downloadUrl = await uploadToR2(zipBuffer, zipKey);

    // Send success email
    await sendSuccessEmail(customerEmail, eventId, downloadUrl);

    // Delete message from queue
    await sqs.deleteMessage({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle
    }).promise();

    console.log(`🎉 PROCESSING COMPLETE: ${eventId}`);
    
  } catch (error) {
    console.error(`❌ Processing failed for ${eventId}:`, error);
    
    // Send error notification
    await sendErrorEmail(customerEmail, eventId, error.message);
    
    // Delete message to prevent infinite retries
    await sqs.deleteMessage({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle
    }).promise();
  }
}

async function pollQueue() {
  while (true) {
    try {
      console.log('🔍 Polling SQS queue for wedding processing jobs...');
      
      const result = await sqs.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 300
      }).promise();

      if (result.Messages && result.Messages.length > 0) {
        lastActivity = Date.now();
        isProcessing = true;
        
        const message = result.Messages[0];
        const messageData = JSON.parse(message.Body);
        const fileCount = messageData.photos?.length || messageData.files?.length || 0;
        console.log(`📦 Received job for eventId: ${messageData.eventId} (${fileCount} files)`);
        
        await processMessage(message);
        
        isProcessing = false;
      }

      // Check for idle timeout
      if (Date.now() - lastActivity > IDLE_TIMEOUT) {
        console.log('⏰ Idle timeout reached, shutting down...');
        console.log(`🕐 Last activity: ${new Date(lastActivity).toISOString()}`);
        console.log(`⏱️ Idle for: ${Math.round((Date.now() - lastActivity) / 1000 / 60)} minutes`);
        
        // Gracefully shutdown the instance
        require('child_process').exec('sudo shutdown -h now', (error) => {
          if (error) {
            console.error('❌ Failed to shutdown:', error);
          }
        });
        
        // Exit the process
        process.exit(0);
      }
    } catch (error) {
      console.error('❌ Queue polling error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

console.log('🚀 Large File Wedding Photo Processor Starting...');
console.log(`📏 Max file size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
pollQueue();
