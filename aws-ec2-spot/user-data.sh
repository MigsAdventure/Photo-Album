#!/bin/bash
set -e

# Redirect all output to log file
exec > >(tee /var/log/user-data.log) 2>&1

echo "🚀 Starting wedding photo processor setup at $(date)"

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
  "name": "wedding-photo-processor",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.450.0",
    "@aws-sdk/client-s3": "^3.450.0",
    "@aws-sdk/lib-storage": "^3.450.0",
    "express": "^4.18.2",
    "archiver": "^5.3.2",
    "node-fetch": "^2.7.0"
  }
}
EOF

# Install dependencies
npm install --production

# Create the processor script with correct R2 credentials
cat > index.js << 'SCRIPT_EOF'
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const express = require('express');
const archiver = require('archiver');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  r2: {
    accountId: '98a9cce92e578cafdb9025fa24a6ee7e',
    accessKeyId: '06da59a3b3aa1315ed2c9a38efa7579e',
    secretAccessKey: 'e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27',
    bucketName: 'sharedmoments-photos-production',
    publicUrl: 'https://sharedmomentsphotos.socialboostai.com'
  },
  sqs: {
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue',
    region: 'us-east-1'
  },
  netlify: {
    emailEndpoint: 'https://sharedmoments.socialboostai.com/.netlify/functions/direct-email'
  }
};

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
  res.json({ status: 'healthy', processing: isProcessing, uptime: process.uptime() });
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
        require('child_process').exec('sudo shutdown -h now');
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
      email: email,
      downloadUrl: downloadUrl,
      fileCount: fileCount,
      finalSizeMB: finalSizeMB.toFixed(2)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email send failed: ${response.status} - ${errorText}`);
  }

  console.log('✅ Email sent successfully');
}

// Start processing
console.log('🚀 Wedding photo processor started');
console.log('📊 R2 Configuration:', {
  accountId: config.r2.accountId,
  bucket: config.r2.bucketName,
  publicUrl: config.r2.publicUrl
});

pollQueue().catch(console.error);
SCRIPT_EOF

# Create systemd service
cat > /etc/systemd/system/wedding-processor.service << 'EOF'
[Unit]
Description=Wedding Photo Processor
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
systemctl enable wedding-processor
systemctl start wedding-processor

echo "✅ Wedding photo processor setup complete at $(date)"
echo "📊 Service status:"
systemctl status wedding-processor --no-pager
