const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { EC2Client, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
const { Upload } = require('@aws-sdk/lib-storage');
const express = require('express');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const { safeEntryName, uniqueEntryName, addFileToArchive } = require('./archive-entries');
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
    emailEndpoint: process.env.NETLIFY_EMAIL_ENDPOINT || 'https://sharedmoments.socialboostai.com/.netlify/functions/direct-email',
    // Proves to the email endpoint that this request came from our own backend
    // rather than from anyone who found the URL (finding SEC-8).
    internalSecret: process.env.INTERNAL_SERVICE_SECRET
  }
};

// Validate environment variables
const requiredEnvVars = [
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'AWS_SQS_QUEUE_URL', 'AWS_REGION',
  'INTERNAL_SERVICE_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

console.log('🚀 Wedding photo streaming processor started (with auto-termination fix)');
console.log('📊 Configuration loaded from environment variables');
console.log('📊 R2 Configuration:', {
  accountId: config.r2.accountId,
  bucket: config.r2.bucketName,
  publicUrl: config.r2.publicUrl
});

// Initialize AWS clients
const sqsClient = new SQSClient({ region: config.sqs.region });
const ec2Client = new EC2Client({ region: config.sqs.region });
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
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes idle timeout to save costs
let jobsProcessed = 0;

// Get IMDSv2 session token (required for EC2 metadata)
async function getImdsSessionToken() {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const options = {
      hostname: '169.254.169.254',
      port: 80,
      path: '/latest/api/token',
      method: 'PUT',
      headers: {
        'X-aws-ec2-metadata-token-ttl-seconds': '21600' // 6 hours
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Got IMDSv2 session token');
          resolve(data.trim());
        } else {
          console.error(`❌ Failed to get IMDSv2 token: HTTP ${res.statusCode}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Error getting IMDSv2 token:', err);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.error('❌ Timeout getting IMDSv2 token');
      resolve(null);
    });

    req.end();
  });
}

// Get instance ID from EC2 metadata (with IMDSv2 support)
async function getInstanceId() {
  return new Promise(async (resolve, reject) => {
    try {
      // Step 1: Get IMDSv2 session token
      const token = await getImdsSessionToken();
      if (!token) {
        console.error('❌ Could not get IMDSv2 session token');
        resolve(null);
        return;
      }

      // Step 2: Use token to fetch instance ID
      const http = require('http');
      const options = {
        hostname: '169.254.169.254',
        port: 80,
        path: '/latest/meta-data/instance-id',
        method: 'GET',
        headers: {
          'X-aws-ec2-metadata-token': token
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`✅ Got instance ID: ${data.trim()}`);
            resolve(data.trim());
          } else {
            console.error(`❌ Failed to get instance ID: HTTP ${res.statusCode}`);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ Error fetching instance ID:', err);
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        console.error('❌ Timeout fetching instance ID');
        resolve(null);
      });

      req.end();
    } catch (error) {
      console.error('❌ Error in getInstanceId:', error);
      resolve(null);
    }
  });
}

// Terminate this EC2 instance
async function terminateInstance() {
  try {
    const instanceId = await getInstanceId();
    if (!instanceId) {
      console.error('❌ Could not get instance ID for termination');
      return;
    }
    
    console.log(`🔪 Terminating instance ${instanceId} after processing ${jobsProcessed} jobs`);
    
    await ec2Client.send(new TerminateInstancesCommand({
      InstanceIds: [instanceId]
    }));
    
    console.log('✅ Instance termination initiated');
  } catch (error) {
    console.error('❌ Failed to terminate instance:', error);
  }
}

// Express server for health checks
const app = express();
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    processing: isProcessing, 
    uptime: process.uptime(),
    type: 'streaming-processor-fixed',
    lastActivity: new Date(lastActivity).toISOString(),
    jobsProcessed
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
        WaitTimeSeconds: 20,
        VisibilityTimeout: 900 // 15 minutes for large jobs
      }));

      if (result.Messages && result.Messages.length > 0) {
        const message = result.Messages[0];
        const jobData = JSON.parse(message.Body);

        console.log(`📦 Received streaming job for eventId: ${jobData.eventId} (${jobData.photos?.length || 0} files)`);
        
        // Calculate total size
        const totalSize = jobData.photos?.reduce((sum, photo) => sum + (photo.size || 0), 0) || 0;
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        console.log(`📊 Total size to process: ${totalSizeMB} MB`);
        
        lastActivity = Date.now();
        isProcessing = true;

        try {
          // Process with longer timeout for large files
          const timeoutMs = Math.max(600000, totalSize / 100); // At least 10 minutes, or 10KB/s minimum
          await Promise.race([
            processStreamingJob(jobData),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Job timeout')), timeoutMs))
          ]);
          
          // Delete message from queue
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          
          jobsProcessed++;
          console.log('✅ Streaming job completed and message deleted from queue');
        } catch (error) {
          console.error('❌ Streaming job processing failed:', error);
          // Message will become visible again after visibility timeout
        }

        isProcessing = false;
      }

      // Check for idle timeout - only when not processing
      if (!isProcessing && Date.now() - lastActivity > IDLE_TIMEOUT) {
        console.log(`⏰ Idle timeout reached (${IDLE_TIMEOUT/1000/60} minutes), terminating instance...`);
        await terminateInstance();
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
    
    const { finalSizeMB, failedCount } = await createStreamingZip(photos, zipKey, eventId);

    // Generate download URL
    const downloadUrl = `${config.r2.publicUrl}/${zipKey}`;
    console.log(`✅ Streaming upload complete: ${downloadUrl}`);

    // Send email via Netlify
    console.log('📧 Sending email notification...');
    await sendEmail(email, eventId, downloadUrl, photos.length, finalSizeMB, failedCount);

    console.log('✅ Streaming job completed successfully!');
  } catch (error) {
    console.error('❌ Error processing streaming job:', error);
    throw error;
  }
}

async function createStreamingZip(photos, zipKey, eventId) {
  const zipStream = new PassThrough();

  const archive = archiver('zip', {
    // Level 1, not 6. Wedding archives are overwhelmingly JPEG and H.264, both
    // already compressed — deflate spends CPU to save a percent or two. On a
    // 2-vCPU t3.medium that compression was a real share of the job's wall
    // clock, and it is now the sequential loop's bottleneck rather than being
    // hidden behind parallel downloads.
    zlib: { level: 1 },
    statConcurrency: 1
  });

  const failures = [];
  const usedNames = new Set();

  archive.on('warning', (error) => {
    // ENOENT is advisory. Anything else means the archive is suspect, and
    // throwing inside an event handler would take the process down rather than
    // failing this job, so record it and let the error handler surface it.
    console.warn(`Archive warning: ${error.message}`);
  });

  archive.pipe(zipStream);

  // Start the upload before writing any entries, so the multipart upload
  // consumes the stream as it fills rather than buffering the archive in memory.
  //
  // Declared here on purpose: it used to be referenced inside archive.on('end')
  // while being declared with const further down, which only worked because the
  // event happened to fire later. Any reordering would have turned that into a
  // TDZ ReferenceError inside an event handler — a crash with no useful stack.
  const fileName = `photos-${eventId || 'download'}.zip`;
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.r2.bucketName,
      Key: zipKey,
      Body: zipStream,
      ContentType: 'application/zip',
      ContentDisposition: `attachment; filename="${fileName}"`
    },
    queueSize: 4,
    partSize: 10 * 1024 * 1024
  });

  upload.on('httpUploadProgress', (progress) => {
    if (progress.loaded) {
      console.log(`⬆️ Uploaded ${(progress.loaded / 1024 / 1024).toFixed(2)}MB`);
    }
  });

  const uploadPromise = upload.done();

  // Surface an upload failure as a rejection we can await, rather than an
  // unhandled rejection that the process-level handler swallows while this
  // function keeps writing entries into a stream nobody is reading.
  let uploadFailed = null;
  uploadPromise.catch((error) => {
    uploadFailed = error;
  });

  console.log(`🌊 Streaming ${photos.length} files, one at a time...`);

  for (let i = 0; i < photos.length; i++) {
    if (uploadFailed) {
      throw new Error(`R2 upload failed partway through: ${uploadFailed.message}`);
    }

    const photo = photos[i];
    const entryName = uniqueEntryName(safeEntryName(photo.fileName, i), usedNames);
    const sizeMB = ((photo.size || 0) / (1024 * 1024)).toFixed(2);

    console.log(`📥 [${i + 1}/${photos.length}] ${entryName} (${sizeMB} MB)`);

    const result = await addFileToArchive(archive, photo, entryName);

    if (!result.ok) {
      console.error(`❌ Gave up on ${photo.fileName}: ${result.error}`);
      failures.push({ fileName: photo.fileName, reason: result.error });
    }
  }

  console.log('🔄 Finalizing archive...');
  await archive.finalize();

  await uploadPromise;
  console.log('✅ Upload to R2 completed');

  const head = await s3Client.send(new HeadObjectCommand({
    Bucket: config.r2.bucketName,
    Key: zipKey
  }));

  const bytes = Number(head.ContentLength || 0);
  if (bytes === 0) {
    throw new Error('Uploaded archive is empty');
  }

  const finalSizeMB = bytes / (1024 * 1024);
  console.log(`🔎 R2 object verified: ${finalSizeMB.toFixed(2)} MB`);

  // A job that dropped a large share of the collection should not be reported to
  // the customer as a success (finding ZIP-7). Better to fail, leave the SQS
  // message for a retry, and alert, than to email a bride an archive that is
  // quietly missing a fifth of her wedding.
  const failureRate = photos.length > 0 ? failures.length / photos.length : 0;
  if (failureRate > 0.05) {
    throw new Error(
      `Too many files failed: ${failures.length}/${photos.length} ` +
      `(${(failureRate * 100).toFixed(0)}%). Not sending a success email. ` +
      `First failure: ${failures[0]?.fileName} — ${failures[0]?.reason}`
    );
  }

  return { finalSizeMB, failedCount: failures.length, failures };
}

async function sendEmail(email, eventId, downloadUrl, fileCount, finalSizeMB, failedCount = 0) {
  try {
    const response = await fetch(config.netlify.emailEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sharedmoments-internal': config.netlify.internalSecret
      },
      body: JSON.stringify({
        email: email,
        downloadUrl: downloadUrl,
        fileCount: fileCount,
        finalSizeMB: finalSizeMB
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Email send failed: ${response.status} - ${errorText}`);
    }

    console.log('✅ Email sent successfully');
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  if (!isProcessing) {
    await terminateInstance();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⚠️ SIGINT received, shutting down gracefully...');
  if (!isProcessing) {
    await terminateInstance();
  }
  process.exit(0);
});

// Unhandled rejection handler (critical!)
process.on('unhandledRejection', (error) => {
  console.error('❌ UNHANDLED REJECTION - This will crash without handler:', error);
  // Don't exit - let the process continue
  // Systemd will handle actual crashes with Restart=on-failure
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  // Exit with error code so systemd restarts with Restart=on-failure
  process.exit(1);
});

// Start processing
pollQueue().catch((error) => {
  console.error('❌ Fatal error in pollQueue:', error);
  process.exit(1); // Exit with error code for systemd restart
});
