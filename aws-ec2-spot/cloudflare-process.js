const express = require('express');
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const archiver = require('archiver');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '50mb' }));

const sqs = new SQSClient({ region: 'us-east-1' });
const s3 = new S3Client({ region: 'us-east-1' });
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';

let lastActivity = Date.now();
let isProcessing = false;

// Auto-shutdown after 10 minutes idle
setInterval(() => {
  if (Date.now() - lastActivity > 600000 && !isProcessing) {
    console.log('🔌 Auto-shutting down due to inactivity (10 min idle)');
    require('child_process').exec('sudo shutdown -h now');
  }
}, 60000);

// SQS Queue Polling for Wedding Processing Jobs
async function pollForJobs() {
  while (true) {
    try {
      console.log('🔍 Polling SQS queue for wedding processing jobs...');
      
      const result = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20, // Long polling
        MessageAttributeNames: ['All']
      }));
      
      if (result.Messages && result.Messages.length > 0) {
        const message = result.Messages[0];
        const jobData = JSON.parse(message.Body);
        
        console.log(`📦 Received job for eventId: ${jobData.eventId} (${jobData.photos.length} files)`);
        lastActivity = Date.now();
        isProcessing = true;
        
        try {
          // Process the wedding photos
          await processWeddingJob(jobData);
          
          // Delete message from queue only after successful processing
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          
          console.log(`✅ Job completed and removed from queue: ${jobData.eventId}`);
          
        } catch (processingError) {
          console.error(`❌ Processing failed for ${jobData.eventId}:`, processingError);
          // Don't delete message from queue - it will retry
        }
        
        isProcessing = false;
        lastActivity = Date.now();
      }
      
    } catch (error) {
      console.error('❌ Queue polling error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
    }
  }
}

async function processWeddingJob(jobData) {
  const { eventId, email, photos, requestId } = jobData;
  const startTime = Date.now();
  
  console.log(`🎥 Processing started: ${eventId}`);
  console.log(`📧 Customer email: ${email}`);
  console.log(`📁 Files to process: ${photos.length}`);
  
  if (!photos || photos.length === 0) {
    throw new Error('No photos provided for processing');
  }
  
  // Create ZIP archive in memory
  console.log(`📦 Creating ZIP archive for ${photos.length} files...`);
  const archive = archiver('zip', { 
    zlib: { level: 6 } // Balanced compression for speed
  });
  
  const zipChunks = [];
  let totalProcessed = 0;
  let totalSizeBytes = 0;
  
  archive.on('data', (chunk) => {
    zipChunks.push(chunk);
  });
  
  archive.on('error', (error) => {
    console.error('❌ Archive error:', error);
    throw error;
  });
  
  // Download and add each photo to archive
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      console.log(`⬇️ Downloading ${i + 1}/${photos.length}: ${photo.fileName || 'photo_' + (i + 1)}`);
      
      const photoBuffer = await downloadFileWithTimeout(photo.url, 60000); // 60s timeout
      const fileName = photo.fileName || `photo_${i + 1}.jpg`;
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      archive.append(photoBuffer, { name: safeFileName });
      totalProcessed++;
      totalSizeBytes += photoBuffer.length;
      
      console.log(`✅ Added ${i + 1}/${photos.length}: ${safeFileName} (${(photoBuffer.length/1024/1024).toFixed(2)}MB)`);
      
    } catch (error) {
      console.error(`❌ Failed to process file ${i + 1}:`, error.message);
      // Continue with other files - don't fail entire job
    }
  }
  
  if (totalProcessed === 0) {
    throw new Error('Failed to download any photos');
  }
  
  console.log(`📊 Downloaded ${totalProcessed}/${photos.length} files (${(totalSizeBytes/1024/1024).toFixed(2)}MB total)`);
  
  // Finalize archive
  archive.finalize();
  
  // Wait for archive to complete
  await new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  
  const zipBuffer = Buffer.concat(zipChunks);
  const finalSizeMB = zipBuffer.length / 1024 / 1024;
  console.log(`🗜️ ZIP archive created: ${finalSizeMB.toFixed(2)}MB`);
  
  // Upload to S3
  const zipFileName = `event_${eventId}_photos_${Date.now()}.zip`;
  const s3Key = `downloads/${zipFileName}`;
  
  console.log(`☁️ Uploading to S3: ${s3Key}`);
  
  await s3.send(new PutObjectCommand({
    Bucket: 'wedding-photo-spot-1752995104', // Your bucket name
    Key: s3Key,
    Body: zipBuffer,
    ContentType: 'application/zip'
  }));
  
  const downloadUrl = `https://wedding-photo-spot-1752995104.s3.amazonaws.com/${s3Key}`;
  console.log(`✅ Uploaded to S3: ${downloadUrl}`);
  
  // Send to Cloudflare Worker
  const processingTimeSeconds = (Date.now() - startTime) / 1000;
  
  await notifyCloudflareWorker(email, eventId, {
    fileCount: totalProcessed,
    originalFileCount: photos.length,
    finalSizeMB: finalSizeMB,
    downloadUrl: downloadUrl,
    processingTimeSeconds: processingTimeSeconds,
    requestId: requestId || `ec2-spot-${Date.now()}`
  });
  
  console.log(`🎉 Processing complete: ${eventId}`);
  console.log(`📊 Stats: ${totalProcessed}/${photos.length} files, ${finalSizeMB.toFixed(2)}MB, ${processingTimeSeconds.toFixed(1)}s`);
  console.log(`💰 Estimated cost: $0.01-0.02 (95% savings vs Lambda!)`);
}

// Download file with timeout
async function downloadFileWithTimeout(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log('🔄 Following redirect...');
        return downloadFileWithTimeout(response.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`✅ Download complete: ${(buffer.length/1024/1024).toFixed(2)}MB`);
        resolve(buffer);
      });
      
      response.on('error', (error) => {
        console.error('❌ Response error:', error.message);
        reject(error);
      });
    });
    
    request.setTimeout(timeoutMs, () => {
      console.error(`⏰ Download timeout after ${timeoutMs/1000}s`);
      request.destroy();
      reject(new Error(`Download timeout (${timeoutMs/1000}s)`));
    });
    
    request.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      reject(error);
    });
  });
}

// Notify Cloudflare Worker to send email
async function notifyCloudflareWorker(email, eventId, stats) {
  console.log(`📧 Notifying Cloudflare Worker for: ${email}`);
  
  try {
    // Use your existing Cloudflare Worker URL
    const workerUrl = 'https://wedding-photo-worker.yourcompany.workers.dev/email';
    
    const payload = {
      eventId,
      email,
      requestId: stats.requestId,
      fileCount: stats.fileCount,
      originalFileCount: stats.originalFileCount,
      finalSizeMB: stats.finalSizeMB,
      downloadUrl: stats.downloadUrl,
      processingTimeSeconds: stats.processingTimeSeconds,
      source: 'aws-ec2-spot'
    };
    
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_SECRET_TOKEN' // Replace with your actual auth token
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Worker responded with ${response.status}: ${errorText}`);
    }
    
    console.log(`✅ Cloudflare Worker notified successfully`);
    
  } catch (error) {
    console.error(`❌ Failed to notify Cloudflare Worker:`, error);
    
    // Fallback to Netlify function as backup
    try {
      const netlifyUrl = 'https://main--sharedmoments.netlify.app/.netlify/functions/email-download';
      
      const response = await fetch(netlifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventId,
          email,
          source: 'aws-ec2-spot',
          downloadUrl: stats.downloadUrl,
          fileCount: stats.fileCount,
          finalSizeMB: stats.finalSizeMB,
          requestId: stats.requestId
        })
      });
      
      if (response.ok) {
        console.log(`✅ Fallback to Netlify function successful`);
      }
    } catch (netlifyError) {
      console.error(`❌ Netlify fallback also failed:`, netlifyError);
    }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  lastActivity = Date.now();
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    purpose: '500MB video processing with SQS queue',
    cost: '~$0.01-0.02 per job',
    isProcessing: isProcessing
  });
});

// Manual processing endpoint (backup)
app.post('/process', async (req, res) => {
  lastActivity = Date.now();
  console.log('📥 Received direct processing request');
  
  const { eventId, email, photos } = req.body;
  
  try {
    isProcessing = true;
    await processWeddingJob({ eventId, email, photos });
    isProcessing = false;
    
    res.json({ 
      success: true, 
      message: `Successfully processed ${photos?.length || 0} files for event ${eventId}`,
      cost: '~$0.01-0.02',
      processingTime: '2-3 minutes',
      instanceType: 't3.medium (spot)'
    });
    
  } catch (error) {
    console.error('Processing error:', error);
    isProcessing = false;
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`🚀 Wedding photo processor running on port ${PORT}`);
  console.log('📬 Starting SQS queue polling for jobs...');
  console.log('💰 Processing 500MB videos cost-efficiently ($0.01-0.02 per job)!');
  
  // Start polling for jobs immediately
  pollForJobs().catch(error => {
    console.error('❌ Queue polling failed:', error);
  });
});