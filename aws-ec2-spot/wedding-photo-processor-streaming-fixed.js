const {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand
} = require('@aws-sdk/client-sqs');
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
    // Points at email-download rather than direct-email. Both send the same
    // template now, but email-download also records the completed archive so a
    // repeat request within the reuse window returns this URL instead of
    // rebuilding the same bytes on a fresh instance.
    emailEndpoint: process.env.NETLIFY_EMAIL_ENDPOINT || 'https://sharedmoments.socialboostai.com/.netlify/functions/email-download',
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

// How long a single receive keeps a message invisible to other consumers. Kept
// short and extended by heartbeat while the job runs (see ZIP-5 below).
const VISIBILITY_SECONDS = 300;          // 5 minutes
const HEARTBEAT_INTERVAL_MS = 120_000;   // extend every 2 minutes
const MAX_JOB_MS = 60 * 60 * 1000;       // hard ceiling: 1 hour

/**
 * Keep a message invisible while we are still working on it (finding ZIP-5).
 *
 * This is the duplicate-email bug. The visibility timeout was a fixed 15
 * minutes, while the job timeout was Math.max(600000, totalSize / 100) - which
 * for a 5 GB collection evaluates to 50,000,000 ms, just under 14 hours. So SQS
 * made the message visible again long before the job finished, a second
 * consumer picked up the same work, and both completed and both sent email.
 *
 * Extending visibility on a heartbeat means the message stays hidden exactly as
 * long as we are genuinely working, and becomes visible promptly if this
 * instance dies - which is what you want a queue to do.
 */
function startVisibilityHeartbeat(receiptHandle, label) {
  const timer = setInterval(async () => {
    try {
      await sqsClient.send(new ChangeMessageVisibilityCommand({
        QueueUrl: config.sqs.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: VISIBILITY_SECONDS
      }));
      console.log(`💓 Extended visibility for ${label}`);
    } catch (error) {
      // Losing the heartbeat is not fatal to this job, but it does mean another
      // consumer may pick the message up. Log loudly so it is visible in
      // CloudWatch if duplicates ever reappear.
      console.error(`⚠️ Failed to extend visibility for ${label}:`, error.message);
    }
  }, HEARTBEAT_INTERVAL_MS);

  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Is the queue empty right now?
 *
 * Used before idle termination (finding ZIP-8). The launcher checks for a
 * running instance and, if it finds one, returns "an existing instance will
 * process it". If that instance was seconds from its idle timeout it then
 * terminated, and nothing ever polled the message - the request vanished with
 * no error anywhere. Draining to empty before shutting down closes that window.
 */
async function queueIsEmpty() {
  try {
    const result = await sqsClient.send(new GetQueueAttributesCommand({
      QueueUrl: config.sqs.queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    }));

    const visible = Number(result.Attributes?.ApproximateNumberOfMessages || 0);
    const inFlight = Number(result.Attributes?.ApproximateNumberOfMessagesNotVisible || 0);

    if (visible + inFlight > 0) {
      console.log(`📬 Queue not empty (${visible} waiting, ${inFlight} in flight) - staying up`);
      return false;
    }

    return true;
  } catch (error) {
    // If we cannot tell, assume there is work. Staying up costs about a cent an
    // hour; terminating with a queued job costs a customer their photos.
    console.error('⚠️ Could not read queue depth, assuming not empty:', error.message);
    return false;
  }
}

// Poll SQS for jobs
async function pollQueue() {
  while (true) {
    try {
      const result = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: config.sqs.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: VISIBILITY_SECONDS
      }));

      if (result.Messages && result.Messages.length > 0) {
        const message = result.Messages[0];
        const jobData = JSON.parse(message.Body);
        const label = `${jobData.eventId} (${jobData.photos?.length || 0} files)`;

        const totalSize = jobData.photos?.reduce((sum, photo) => sum + (photo.size || 0), 0) || 0;
        console.log(`📦 Received job for ${label}, ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);

        lastActivity = Date.now();
        isProcessing = true;

        const stopHeartbeat = startVisibilityHeartbeat(message.ReceiptHandle, label);

        try {
          // A hard ceiling, not a size-derived one. The old formula produced
          // timeouts measured in hours, which is indistinguishable from no
          // timeout at all - a wedged job would hold the instance up
          // indefinitely. An hour is far longer than any legitimate archive and
          // short enough to recover from.
          await Promise.race([
            processStreamingJob(jobData),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Job exceeded ${MAX_JOB_MS / 60000} minute ceiling`)), MAX_JOB_MS)
            )
          ]);

          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));

          jobsProcessed++;
          console.log(`✅ Completed ${label} and removed it from the queue`);
        } catch (error) {
          console.error(`❌ Job failed for ${label}:`, error.message);

          // Return the message immediately rather than waiting out the
          // visibility window, so a retry (or the dead-letter queue, once it is
          // configured) happens promptly.
          try {
            await sqsClient.send(new ChangeMessageVisibilityCommand({
              QueueUrl: config.sqs.queueUrl,
              ReceiptHandle: message.ReceiptHandle,
              VisibilityTimeout: 30
            }));
          } catch (visibilityError) {
            console.error('⚠️ Could not reset visibility:', visibilityError.message);
          }
        } finally {
          stopHeartbeat();
          isProcessing = false;
          lastActivity = Date.now();
        }
      }

      // Idle shutdown - but never while there is work outstanding (ZIP-8).
      if (!isProcessing && Date.now() - lastActivity > IDLE_TIMEOUT) {
        if (await queueIsEmpty()) {
          console.log(`⏰ Idle for ${IDLE_TIMEOUT / 60000} minutes and the queue is empty, terminating`);
          await terminateInstance();
          process.exit(0);
        }
        lastActivity = Date.now();
      }
    } catch (error) {
      console.error('❌ Queue polling error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function processStreamingJob(jobData) {
  const { eventId, email, photos = [], requestId } = jobData;
  console.log(`🚀 Archiving ${photos.length} files for event ${eventId}`);

  // A unique key per job (finding ZIP-6).
  //
  // Every archive for an event previously wrote to events/{eventId}/photos.zip.
  // A second request overwrote the object while a guest might be mid-download of
  // the first, handing them a corrupt file, and silently changed what every
  // previously emailed link pointed at. The Netlify path wrote to a completely
  // different scheme (downloads/event_{id}_photos_{ts}.zip), so the two engines
  // produced URLs in unrelated namespaces.
  //
  // One scheme, one namespace, immutable objects. Set an R2 lifecycle rule to
  // expire the archives/ prefix after 30 days - they are regenerable, and the
  // year of access the email promises is for the photos, which is a different
  // thing.
  const jobId = requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const zipKey = `archives/${eventId}/${jobId}.zip`;

  const { finalSizeMB, failedCount, failures } = await createStreamingZip(photos, zipKey, eventId);

  const downloadUrl = `${config.r2.publicUrl}/${zipKey}`;
  console.log(`✅ Archive ready: ${downloadUrl}`);

  if (failedCount > 0) {
    console.warn(`⚠️ ${failedCount} file(s) could not be included:`, failures.map(f => f.fileName).join(', '));
  }

  await sendEmail(email, eventId, downloadUrl, photos.length - failedCount, finalSizeMB, failedCount);
  console.log('✅ Job complete');
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
        source: 'processor',
        eventId: eventId,
        email: email,
        downloadUrl: downloadUrl,
        fileCount: fileCount,
        finalSizeMB: finalSizeMB,
        failedCount: failedCount
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
