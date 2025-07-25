const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const express = require('express');
const archiver = require('archiver');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Configuration from environment variables
const config = {
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
    publicUrl: process.env.R2_PUBLIC_URL
  },
  sqs: {
    queueUrl: process.env.AWS_SQS_QUEUE_URL,
    region: process.env.AWS_REGION
  },
  netlify: {
    emailEndpoint: process.env.NETLIFY_EMAIL_ENDPOINT || 'https://sharedmoments.socialboostai.com/.netlify/functions/direct-email'
  }
};

// Validate environment variables
const requiredEnvVars = [
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 
  'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'AWS_SQS_QUEUE_URL', 'AWS_REGION'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

console.log('🚀 Wedding photo processor started');
console.log('📊 Configuration loaded from environment variables');
console.log('📊 R2 Configuration:', {
  accountId: config.r2.accountId,
  bucket: config.r2.bucketName,
  publicUrl: config.r2.publicUrl
});

// Initialize AWS clients
const sqsClient = new SQSClient({ region: config.sqs.region });
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey
  }
});

// Processing state
let isProcessing = false;
let lastActivity = Date.now();
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Express server for health checks
const app = express();
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    processing: isProcessing, 
    uptime: process.uptime(),
    lastActivity: new Date(lastActivity).toISOString()
  });
});
app.listen(8080, () => console.log('Health check server running on port 8080'));

// Poll SQS for jobs
async function pollQueue() {
  while (true) {
    try {
      const result = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: config.sqs.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20
      }));

      if (result.Messages && result.Messages.length > 0) {
        const message = result.Messages[0];
        const jobData = JSON.parse(message.Body);

        console.log(`📦 Received job for eventId: ${jobData.eventId} (${jobData.photos?.length || 0} files)`);
        lastActivity = Date.now();
        isProcessing = true;

        try {
          await processJob(jobData);
          
          // Delete message from queue
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          
          console.log('✅ Job completed and message deleted from queue');
        } catch (error) {
          console.error('❌ Job processing failed:', error);
        }

        isProcessing = false;
      }

      // Check for idle timeout
      if (Date.now() - lastActivity > IDLE_TIMEOUT) {
        console.log('⏰ Idle timeout reached, shutting down...');
        process.exit(0);
      }
    } catch (error) {
      console.error('❌ Queue polling error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function processJob(jobData) {
  const { eventId, email, photos = [] } = jobData;
  console.log(`🚀 Processing ${photos.length} files for event ${eventId}`);

  const tempDir = `/tmp/${eventId}`;
  fs.mkdirSync(tempDir, { recursive: true });
  let zipSizeMB = 0;

  try {
    // Download all files
    console.log('📥 Downloading files...');
    for (const photo of photos) {
      await downloadFile(photo.url, path.join(tempDir, photo.fileName));
    }

    // Create ZIP
    const zipPath = `/tmp/${eventId}.zip`;
    console.log('📦 Creating ZIP archive...');
    await createZipArchive(tempDir, zipPath);
    
    // Get ZIP file size
    const stats = fs.statSync(zipPath);
    zipSizeMB = stats.size / (1024 * 1024);

    // Upload to R2
    const zipKey = `events/${eventId}/photos.zip`;
    console.log('☁️ Uploading to R2...');
    await uploadToR2(zipPath, zipKey);

    // Generate download URL
    const downloadUrl = `${config.r2.publicUrl}/${zipKey}`;
    console.log(`✅ Upload complete: ${downloadUrl}`);

    // Send email via Netlify
    console.log('📧 Sending email notification...');
    await sendEmail(email, eventId, downloadUrl, photos.length, zipSizeMB);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(zipPath);

    console.log('✅ Job completed successfully!');
  } catch (error) {
    console.error('❌ Error processing job:', error);
    throw error;
  }
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${url}`);
  
  const fileStream = fs.createWriteStream(outputPath);
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    response.body.on('error', reject);
    fileStream.on('finish', resolve);
  });
}

async function createZipArchive(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`📦 ZIP created: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function uploadToR2(filePath, key) {
  const fileStream = fs.createReadStream(filePath);
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.r2.bucketName,
      Key: key,
      Body: fileStream,
      ContentType: 'application/zip'
    }
  });

  await upload.done();
}

async function sendEmail(email, eventId, downloadUrl, fileCount, finalSizeMB) {
  const response = await fetch(config.netlify.emailEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: email,
      subject: 'Your Wedding Photos Are Ready!',
      html: `
        <h2>Your Wedding Photos Are Ready!</h2>
        <p>Your wedding photos for event <strong>${eventId}</strong> have been processed and are ready for download!</p>
        <p><strong>Files:</strong> ${fileCount} photos (${finalSizeMB.toFixed(2)}MB)</p>
        <p><a href="${downloadUrl}" style="background-color: #4CAF50; color: white; padding: 14px 20px; text-decoration: none; border-radius: 4px;">Download Your Photos</a></p>
        <p>This download link will be available for 7 days.</p>
      `
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email send failed: ${response.status} - ${errorText}`);
  }

  console.log('✅ Email sent successfully');
}

// Start processing
pollQueue().catch(console.error);
