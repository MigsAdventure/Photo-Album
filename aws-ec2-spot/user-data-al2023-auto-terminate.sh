#!/bin/bash

# User data script for Amazon Linux 2023 with auto-termination and streaming fixes
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
echo "Starting EC2 instance setup (AL2023 with auto-termination) at $(date)"

# Update system
dnf update -y

# Install dependencies
echo "Installing Node.js 20 and required packages..."
dnf install -y nodejs npm git aws-cli

# Verify Node.js version
node -v
npm -v

# Create application directory
mkdir -p /home/ec2-user/wedding-processor
cd /home/ec2-user/wedding-processor

# Create the fixed streaming processor with all improvements
cat > wedding-photo-processor-streaming.js << 'EOF'
const AWS = require('aws-sdk');
const { Readable, PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const archiver = require('archiver');
const https = require('https');
const http = require('http');

// Configuration with environment variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/654654379834/wedding-photo-processing-queue';
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'miguels-wedding-photos';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '9c04be9cb00bf3b56e2c509e2f58f69c';
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Initialize AWS SDK
AWS.config.update({ region: REGION });
const sqs = new AWS.SQS();
const ec2 = new AWS.EC2();

// Initialize R2 client
const r2Client = new AWS.S3({
    endpoint: R2_ENDPOINT,
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
    region: 'auto',
    signatureVersion: 'v4',
    s3ForcePathStyle: true
});

// CloudWatch Logs setup
const CloudWatchLogs = AWS.CloudWatchLogs;
const cloudwatchlogs = new CloudWatchLogs({ region: REGION });
const INSTANCE_ID = process.env.INSTANCE_ID || 'unknown';
const LOG_GROUP = '/wedding-photo-processor';
const APP_LOG_STREAM = `${LOG_GROUP}/application`;
const ERROR_LOG_STREAM = `${LOG_GROUP}/error`;
const LOG_STREAM_NAME = `${INSTANCE_ID}-fixed`;

let appSequenceToken = null;
let errorSequenceToken = null;
let lastIdleCheck = Date.now();
let isProcessing = false;

// Auto-termination settings
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const CHECK_INTERVAL_MS = 30 * 1000; // Check every 30 seconds

async function initializeLogStreams() {
    try {
        // Ensure log group exists
        try {
            await cloudwatchlogs.createLogGroup({ logGroupName: LOG_GROUP }).promise();
        } catch (err) {
            if (err.code !== 'ResourceAlreadyExistsException') {
                console.error('Error creating log group:', err);
            }
        }

        // Create application log stream
        try {
            await cloudwatchlogs.createLogStream({
                logGroupName: APP_LOG_STREAM,
                logStreamName: LOG_STREAM_NAME
            }).promise();
        } catch (err) {
            if (err.code !== 'ResourceAlreadyExistsException') {
                console.error('Error creating app log stream:', err);
            }
        }

        // Create error log stream
        try {
            await cloudwatchlogs.createLogStream({
                logGroupName: ERROR_LOG_STREAM,
                logStreamName: LOG_STREAM_NAME
            }).promise();
        } catch (err) {
            if (err.code !== 'ResourceAlreadyExistsException') {
                console.error('Error creating error log stream:', err);
            }
        }

        console.log(`CloudWatch log streams initialized: ${LOG_STREAM_NAME}`);
    } catch (error) {
        console.error('Failed to initialize log streams:', error);
    }
}

async function logToCloudWatch(message, isError = false) {
    const logGroupName = isError ? ERROR_LOG_STREAM : APP_LOG_STREAM;
    const logEvent = {
        message: typeof message === 'object' ? JSON.stringify(message) : String(message),
        timestamp: Date.now()
    };

    const params = {
        logEvents: [logEvent],
        logGroupName,
        logStreamName: LOG_STREAM_NAME
    };

    // Add sequence token if we have one
    if (isError && errorSequenceToken) {
        params.sequenceToken = errorSequenceToken;
    } else if (!isError && appSequenceToken) {
        params.sequenceToken = appSequenceToken;
    }

    try {
        const response = await cloudwatchlogs.putLogEvents(params).promise();
        if (isError) {
            errorSequenceToken = response.nextSequenceToken;
        } else {
            appSequenceToken = response.nextSequenceToken;
        }
    } catch (error) {
        if (error.code === 'InvalidSequenceTokenException') {
            // Update the sequence token and retry
            params.sequenceToken = error.expectedSequenceToken;
            try {
                const response = await cloudwatchlogs.putLogEvents(params).promise();
                if (isError) {
                    errorSequenceToken = response.nextSequenceToken;
                } else {
                    appSequenceToken = response.nextSequenceToken;
                }
            } catch (retryError) {
                console.error('Failed to log to CloudWatch after retry:', retryError);
            }
        } else if (error.code === 'DataAlreadyAcceptedException') {
            // Log was already accepted, just update the token
            if (isError) {
                errorSequenceToken = error.expectedSequenceToken;
            } else {
                appSequenceToken = error.expectedSequenceToken;
            }
        } else {
            console.error('Failed to log to CloudWatch:', error);
        }
    }
}

// Enhanced logging functions
async function log(message) {
    console.log(message);
    await logToCloudWatch(message, false);
}

async function logError(message) {
    console.error(message);
    await logToCloudWatch(message, true);
}

// Auto-termination check
async function checkIdleAndTerminate() {
    if (isProcessing) {
        lastIdleCheck = Date.now();
        return;
    }

    const idleTime = Date.now() - lastIdleCheck;
    await log(`Idle check: ${Math.floor(idleTime / 1000)}s idle, processing: ${isProcessing}`);

    if (idleTime > IDLE_TIMEOUT_MS) {
        await log(`Instance has been idle for ${Math.floor(idleTime / 1000)}s. Initiating auto-termination...`);
        
        try {
            // Get instance ID from metadata service
            const instanceId = await getInstanceId();
            
            await log(`Terminating instance ${instanceId}...`);
            await ec2.terminateInstances({
                InstanceIds: [instanceId]
            }).promise();
            
            await log('Termination request sent successfully');
            process.exit(0);
        } catch (error) {
            await logError(`Failed to auto-terminate: ${error.message}`);
        }
    }
}

async function getInstanceId() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '169.254.169.254',
            path: '/latest/meta-data/instance-id',
            method: 'GET',
            timeout: 5000
        };

        const req = http.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout getting instance ID'));
        });
    });
}

function fetchWithRetry(url, maxRetries = 3) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        
        const attemptFetch = () => {
            attempts++;
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;
            
            const req = client.get(url, {
                headers: {
                    'User-Agent': 'Wedding-Photo-Processor/1.0'
                }
            }, (res) => {
                if (res.statusCode === 200) {
                    resolve(res);
                } else if (res.statusCode >= 500 && attempts < maxRetries) {
                    setTimeout(attemptFetch, 1000 * attempts);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
            
            req.on('error', (err) => {
                if (attempts < maxRetries) {
                    setTimeout(attemptFetch, 1000 * attempts);
                } else {
                    reject(err);
                }
            });
            
            req.setTimeout(30000, () => {
                req.destroy();
                if (attempts < maxRetries) {
                    setTimeout(attemptFetch, 1000 * attempts);
                } else {
                    reject(new Error('Request timeout'));
                }
            });
        };
        
        attemptFetch();
    });
}

async function processMessage(message) {
    isProcessing = true;
    lastIdleCheck = Date.now();
    
    try {
        const body = JSON.parse(message.Body);
        const { photos, eventId, userEmail, eventName } = body;
        
        await log(`Processing ${photos.length} photos for event ${eventId}`);
        
        const zipKey = `events/${eventId}/download/${eventId}-photos.zip`;
        const friendlyFilename = eventName ? 
            `${eventName.replace(/[^a-z0-9]/gi, '_')}_photos.zip` : 
            `${eventId}-photos.zip`;
        
        await log(`Creating ZIP: ${zipKey} (display as: ${friendlyFilename})`);
        
        // Create archive
        const archive = archiver('zip', {
            zlib: { level: 6 }
        });
        
        // Set up the streaming upload to R2
        const passThrough = new PassThrough();
        
        const uploadPromise = r2Client.upload({
            Bucket: R2_BUCKET_NAME,
            Key: zipKey,
            Body: passThrough,
            ContentType: 'application/zip',
            ContentDisposition: `attachment; filename="${friendlyFilename}"`,
            Metadata: {
                eventId: eventId,
                photoCount: String(photos.length),
                userEmail: userEmail || '',
                processedAt: new Date().toISOString()
            }
        }).promise();
        
        // Pipe archive to upload stream
        archive.pipe(passThrough);
        
        // Process photos
        let processedCount = 0;
        let failedFiles = [];
        
        for (const photo of photos) {
            try {
                const response = await fetchWithRetry(photo.url);
                const filename = photo.fileName || `photo_${processedCount + 1}.jpg`;
                
                archive.append(response, { name: filename });
                processedCount++;
                
                if (processedCount % 10 === 0) {
                    await log(`Progress: ${processedCount}/${photos.length} files added`);
                }
            } catch (error) {
                await logError(`Failed to fetch photo: ${error.message}`);
                failedFiles.push(photo.fileName || photo.url);
            }
        }
        
        // CRITICAL: Finalize the archive to complete the stream
        await new Promise((resolve, reject) => {
            archive.on('end', resolve);
            archive.on('error', reject);
            archive.finalize();
        });
        
        // CRITICAL: Wait for upload to complete with proper await
        const uploadResult = await uploadPromise;
        await log(`Upload completed. ETag: ${uploadResult.ETag}`);
        
        // Verify the upload with HeadObject
        const headResult = await r2Client.headObject({
            Bucket: R2_BUCKET_NAME,
            Key: zipKey
        }).promise();
        
        await log(`Upload verified. Size: ${headResult.ContentLength} bytes`);
        
        // Send completion email
        if (userEmail) {
            const downloadUrl = `https://photos.lovewithoutborders.email/.netlify/functions/r2-download?key=${encodeURIComponent(zipKey)}`;
            await sendCompletionEmail(userEmail, downloadUrl, eventId, failedFiles);
        }
        
        // Delete message from queue
        await sqs.deleteMessage({
            QueueUrl: SQS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle
        }).promise();
        
        await log(`Successfully processed event ${eventId}: ${processedCount} photos, ${failedFiles.length} failed`);
        
    } catch (error) {
        await logError(`Error processing message: ${error.message}\n${error.stack}`);
        throw error;
    } finally {
        isProcessing = false;
    }
}

async function sendCompletionEmail(userEmail, downloadUrl, eventId, failedFiles) {
    try {
        const emailData = {
            to: userEmail,
            subject: 'Your wedding photos are ready!',
            body: {
                text: `Your photo collection is ready for download!\n\nEvent ID: ${eventId}\nDownload Link: ${downloadUrl}\n\nThis link will expire in 24 hours.${failedFiles.length > 0 ? `\n\nNote: ${failedFiles.length} file(s) could not be included in the ZIP.` : ''}`,
                html: `
                    <h2>Your photo collection is ready!</h2>
                    <p><strong>Event ID:</strong> ${eventId}</p>
                    <p><a href="${downloadUrl}" style="display:inline-block;padding:12px 24px;background-color:#4CAF50;color:white;text-decoration:none;border-radius:4px;">Download Photos</a></p>
                    <p><small>This link will expire in 24 hours.</small></p>
                    ${failedFiles.length > 0 ? `<p><small>Note: ${failedFiles.length} file(s) could not be included in the ZIP.</small></p>` : ''}
                `
            }
        };

        const response = await fetch('https://miguelgonzalez1939.api.systeme.io/api/transactionals', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.SYSTEME_API_KEY
            },
            body: JSON.stringify(emailData)
        });

        if (!response.ok) {
            throw new Error(`Email API returned ${response.status}`);
        }

        await log(`Email sent successfully to ${userEmail}`);
    } catch (error) {
        await logError(`Failed to send email: ${error.message}`);
    }
}

async function pollQueue() {
    while (true) {
        try {
            const params = {
                QueueUrl: SQS_QUEUE_URL,
                MaxNumberOfMessages: 1,
                WaitTimeSeconds: 20,
                VisibilityTimeout: 3600
            };
            
            const data = await sqs.receiveMessage(params).promise();
            
            if (data.Messages && data.Messages.length > 0) {
                await log(`Received ${data.Messages.length} message(s) from queue`);
                
                for (const message of data.Messages) {
                    await processMessage(message);
                }
            }
        } catch (error) {
            await logError(`Queue polling error: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Health check endpoint
const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'healthy', 
            processing: isProcessing,
            instanceId: INSTANCE_ID,
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

async function main() {
    await log('Starting Wedding Photo Processor (AL2023 with auto-termination)...');
    await initializeLogStreams();
    
    // Start health check server
    healthServer.listen(8080, () => {
        log('Health check server listening on port 8080');
    });
    
    // Start auto-termination checker
    setInterval(checkIdleAndTerminate, CHECK_INTERVAL_MS);
    
    // Start polling
    await log('Starting queue polling...');
    pollQueue().catch(err => {
        logError(`Fatal error: ${err.message}`);
        process.exit(1);
    });
}

// Install dependencies
const { execSync } = require('child_process');
try {
    execSync('npm list aws-sdk', { stdio: 'ignore' });
} catch {
    console.log('Installing dependencies...');
    execSync('npm install aws-sdk archiver', { stdio: 'inherit' });
}

main();
EOF

# Install Node.js dependencies
npm install aws-sdk archiver

# Create systemd service
cat > /etc/systemd/system/wedding-streaming-processor.service << 'EOF'
[Unit]
Description=Wedding Photo Streaming Processor
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/wedding-processor
ExecStart=/usr/bin/node wedding-photo-processor-streaming.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=wedding-processor

Environment="AWS_REGION=us-east-1"
Environment="NODE_ENV=production"
Environment="R2_ACCESS_KEY_ID=726f0a5bdc6875ec2aa7a8102c6c8b29"
Environment="R2_SECRET_ACCESS_KEY=3b01b8e969d99c3bb0c3e7db50edf3de6e8c59dea87cfa967c18dc956c07ff77"
Environment="SYSTEME_API_KEY=cd0e896f13c7ad0af079db93b72e4c38b060f0e1af8f1bdaf21f4b5b7f85a0f0:43e699f37e4c8e088a29a19e0baaedd5"
Environment="INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)"

[Install]
WantedBy=multi-user.target
EOF

# Set proper permissions
chown -R ec2-user:ec2-user /home/ec2-user/wedding-processor

# Enable and start the service
systemctl daemon-reload
systemctl enable wedding-streaming-processor
systemctl start wedding-streaming-processor

# Setup CloudWatch agent for system logs
dnf install -y amazon-cloudwatch-agent

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'EOF'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/wedding-photo-processor/bootstrap",
            "log_stream_name": "{instance_id}-fixed"
          }
        ]
      }
    }
  }
}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

echo "Setup complete at $(date)"
echo "Service status:"
systemctl status wedding-streaming-processor --no-pager
