const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { EC2Client, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
const { Upload } = require('@aws-sdk/lib-storage');
const express = require('express');
const archiver = require('archiver');
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

// Get instance ID from EC2 metadata
async function getInstanceId() {
  try {
    const response = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
      timeout: 1000
    });
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    console.error('Failed to get instance ID:', error);
    return null;
  }
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
  return new Promise(async (resolve, reject) => {
    try {
      // Create a PassThrough stream for the ZIP
      const zipStream = new PassThrough();
      const archive = archiver('zip', { 
        zlib: { level: 6 }, // Reduced compression for faster processing
        statConcurrency: 1 // Process files one at a time to manage memory
      });
      
      let processedFiles = 0;
      let totalBytes = 0;
      let failedCount = 0;

      // Track archive progress
      archive.on('progress', (progress) => {
        processedFiles = progress.entries.processed;
        totalBytes = progress.bytes;
        console.log(`📦 Processed ${progress.entries.processed}/${progress.entries.total} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
      });

      archive.on('end', async () => {
        const finalSizeMB = archive.pointer() / (1024 * 1024);
        console.log(`🌊 Streaming ZIP completed: ${finalSizeMB.toFixed(2)} MB`);

        try {
          // Wait for upload to complete
          await uploadPromise;
          console.log('✅ Upload to R2 completed');

          // Verify object exists and size > 0
          try {
            const head = await s3Client.send(new HeadObjectCommand({
              Bucket: config.r2.bucketName,
              Key: zipKey
            }));
            const sizeMB = (Number(head.ContentLength || 0) / (1024 * 1024)).toFixed(2);
            console.log(`🔎 R2 object verified. Content-Length: ${sizeMB} MB`);
            
            if (Number(head.ContentLength) === 0) {
              throw new Error('Uploaded file is empty');
            }
          } catch (headErr) {
            console.error('⚠️ HeadObject verification failed:', headErr);
            throw headErr;
          }

          resolve({ finalSizeMB, failedCount });
        } catch (err) {
          console.error('❌ Upload completion error:', err);
          reject(err);
        }
      });

      archive.on('error', (err) => {
        console.error('❌ Archive error:', err);
        reject(err);
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('⚠️ Archive warning:', err);
        } else {
          throw err;
        }
      });

      // Pipe archive to our stream
      archive.pipe(zipStream);

      // Start upload to R2 while creating ZIP
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
        queueSize: 4, // Parallel parts
        partSize: 10 * 1024 * 1024 // 10MB parts for large files
      });

      // Monitor upload progress
      upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded && progress.total) {
          const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
          console.log(`⬆️ Upload progress: ${percent}% (${(progress.loaded / 1024 / 1024).toFixed(2)}MB / ${(progress.total / 1024 / 1024).toFixed(2)}MB)`);
        }
      });

      // Start the upload (this will consume the zipStream as we write to it)
      const uploadPromise = upload.done();

      // Add files to archive by streaming them directly
      console.log(`🌊 Starting to stream ${photos.length} files...`);
      
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const sizeMB = ((photo.size || 0) / (1024 * 1024)).toFixed(2);
        console.log(`📥 Streaming file ${i + 1}/${photos.length}: ${photo.fileName} (${sizeMB} MB)`);
        
        try {
          // Add timeout for fetch
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120000); // 2 minutes per file
          
          const response = await fetch(photo.url, {
            signal: controller.signal
          });
          
          clearTimeout(timeout);
          
          if (!response.ok) {
            console.error(`❌ Failed to fetch ${photo.fileName}: ${response.status}`);
            failedCount++;
            continue;
          }

          // Add the response stream directly to the archive
          archive.append(response.body, { 
            name: photo.fileName,
            date: new Date()
          });
          
          // Add a small delay between files to prevent overwhelming the system
          if (i < photos.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 50)); // Reduced delay
          }
        } catch (error) {
          console.error(`❌ Error streaming ${photo.fileName}:`, error.message || error);
          failedCount++;
          // Continue with next file instead of failing entire job
        }
      }

      // Finalize the archive (this will end the stream)
      console.log('🔄 Finalizing archive...');
      archive.finalize();

    } catch (error) {
      console.error('❌ Streaming ZIP creation error:', error);
      reject(error);
    }
  });
}

async function sendEmail(email, eventId, downloadUrl, fileCount, finalSizeMB, failedCount = 0) {
  try {
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
          ${failedCount > 0 ? `<p><strong>Note:</strong> ${failedCount} file(s) could not be processed and were skipped.</p>` : ''}
          <p><a href="${downloadUrl}" style="background-color: #4CAF50; color: white; padding: 14px 20px; text-decoration: none; border-radius: 4px;">Download Your Photos</a></p>
          <p>This download link will be available for 7 days.</p>
          <p><em>Processed with streaming technology for optimal performance and memory efficiency.</em></p>
        `
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

// Start processing
pollQueue().catch(console.error);
