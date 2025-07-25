#!/bin/bash
set -e

# Redirect all output to log file
exec > >(tee /var/log/user-data.log) 2>&1

echo "🚀 Starting wedding photo streaming processor setup at $(date)"

# Update system
yum update -y

# Install Node.js 16.x
curl -fsSL https://rpm.nodesource.com/setup_16.x | bash -
yum install -y nodejs

# Create app directory
mkdir -p /app
cd /app

# Create package.json
cat > package.json << 'EOF'
{
  "name": "wedding-photo-streaming-processor",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.450.0",
    "@aws-sdk/client-s3": "^3.450.0",
    "@aws-sdk/lib-storage": "^3.450.0",
    "express": "^4.18.2",
    "archiver": "^5.3.2",
    "node-fetch": "^2.7.0",
    "stream": "^0.0.2"
  }
}
EOF

# Install dependencies
npm install --production

# Create the streaming processor script with environment variable placeholders
cat > index.js << 'SCRIPT_EOF'
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const express = require('express');
const archiver = require('archiver');
const fetch = require('node-fetch');
const { PassThrough } = require('stream');
const fs = require('fs');

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
const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes for streaming

// Express server for health checks
const app = express();
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    processing: isProcessing, 
    uptime: process.uptime(),
    type: 'streaming-processor'
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

        console.log(`📦 Received streaming job for eventId: ${jobData.eventId} (${jobData.photos?.length || 0} files)`);
        lastActivity = Date.now();
        isProcessing = true;

        try {
          await processStreamingJob(jobData);
          
          // Delete message from queue
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          
          console.log('✅ Streaming job completed and message deleted from queue');
        } catch (error) {
          console.error('❌ Streaming job processing failed:', error);
        }

        isProcessing = false;
      }

      // Check for idle timeout
      if (Date.now() - lastActivity > IDLE_TIMEOUT) {
        console.log('⏰ Idle timeout reached, shutting down...');
        require('child_process').exec('sudo shutdown -h now');
        process.exit(0);
      }
    } catch (error) {
      console.error('❌ Queue polling error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function processStreamingJob(jobData) {
  const { eventId, email, photos = [] } = jobData;
  console.log(`🚀 Starting streaming processing for ${photos.length} files for event ${eventId}`);

  try {
    // Create streaming ZIP and upload directly to R2
    const zipKey = `events/${eventId}/photos.zip`;
    console.log('🌊 Starting streaming ZIP creation and upload...');
    
    const { finalSizeMB } = await createStreamingZip(photos, zipKey);

    // Generate download URL
    const downloadUrl = `${config.r2.publicUrl}/${zipKey}`;
    console.log(`✅ Streaming upload complete: ${downloadUrl}`);

    // Send email via Netlify
    console.log('📧 Sending email notification...');
    await sendEmail(email, eventId, downloadUrl, photos.length, finalSizeMB);

    console.log('✅ Streaming job completed successfully!');
  } catch (error) {
    console.error('❌ Error processing streaming job:', error);
    throw error;
  }
}

async function createStreamingZip(photos, zipKey) {
  return new Promise(async (resolve, reject) => {
    try {
      // Create a PassThrough stream for the ZIP
      const zipStream = new PassThrough();
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      let totalBytes = 0;

      // Track archive progress
      archive.on('progress', (progress) => {
        totalBytes = progress.entries.processed;
        console.log(`📦 Processed ${progress.entries.processed}/${progress.entries.total} files`);
      });

      archive.on('end', () => {
        const finalSizeMB = archive.pointer() / (1024 * 1024);
        console.log(`🌊 Streaming ZIP completed: ${finalSizeMB.toFixed(2)} MB`);
        resolve({ finalSizeMB });
      });

      archive.on('error', reject);

      // Pipe archive to our stream
      archive.pipe(zipStream);

      // Start upload to R2 while creating ZIP
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: config.r2.bucketName,
          Key: zipKey,
          Body: zipStream,
          ContentType: 'application/zip'
        }
      });

      // Start the upload (this will consume the zipStream as we write to it)
      upload.done().catch(reject);

      // Add files to archive by streaming them
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        console.log(`📥 Streaming file ${i + 1}/${photos.length}: ${photo.fileName}`);
        
        try {
          const response = await fetch(photo.url);
          if (!response.ok) {
            console.error(`❌ Failed to fetch ${photo.fileName}: ${response.status}`);
            continue;
          }

          // Add the response stream directly to the archive
          archive.append(response.body, { name: photo.fileName });
        } catch (error) {
          console.error(`❌ Error streaming ${photo.fileName}:`, error);
        }
      }

      // Finalize the archive (this will end the stream)
      archive.finalize();

    } catch (error) {
      reject(error);
    }
  });
}

async function sendEmail(email, eventId, downloadUrl, fileCount, finalSizeMB) {
  const response = await fetch(config.netlify.emailEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: email,
      subject: 'Your Wedding Photos Are Ready! (Streaming Processed)',
      html: `
        <h2>Your Wedding Photos Are Ready!</h2>
        <p>Your wedding photos for event <strong>${eventId}</strong> have been processed using our advanced streaming technology and are ready for download!</p>
        <p><strong>Files:</strong> ${fileCount} photos (${finalSizeMB.toFixed(2)}MB)</p>
        <p><a href="${downloadUrl}" style="background-color: #4CAF50; color: white; padding: 14px 20px; text-decoration: none; border-radius: 4px;">Download Your Photos</a></p>
        <p>This download link will be available for 7 days.</p>
        <p><em>Processed with streaming technology for faster delivery.</em></p>
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
console.log('🚀 Wedding photo streaming processor started');
console.log('📊 Configuration loaded from environment variables');
console.log('📊 R2 Configuration:', {
  accountId: config.r2.accountId,
  bucket: config.r2.bucketName,
  publicUrl: config.r2.publicUrl
});

pollQueue().catch(console.error);
SCRIPT_EOF

# Create systemd service
cat > /etc/systemd/system/wedding-streaming-processor.service << 'EOF'
[Unit]
Description=Wedding Photo Streaming Processor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/app
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
systemctl daemon-reload
systemctl enable wedding-streaming-processor
systemctl start wedding-streaming-processor

echo "✅ Wedding photo streaming processor setup complete at $(date)"
echo "📊 Service status:"
systemctl status wedding-streaming-processor --no-pager
