#!/bin/bash
# Setup CloudWatch Logs for EC2 instances
set -e

echo "🔍 Setting up CloudWatch Logs for EC2 instances..."

# Update the user-data script to include CloudWatch Logs configuration
cat > updated-user-data-with-logs.sh << 'EOF'
#!/bin/bash
set -e
exec > >(tee /var/log/user-data.log) 2>&1

echo "🚀 Starting wedding photo processor bootstrap with CloudWatch Logs..."

# Update system
yum update -y

# Install CloudWatch Logs agent
yum install -y awslogs

# Configure CloudWatch Logs
cat > /etc/awslogs/awslogs.conf << 'CWCONF'
[general]
state_file = /var/lib/awslogs/agent-state

[/var/log/messages]
file = /var/log/messages
log_group_name = /wedding-photo-processor/system
log_stream_name = {instance_id}/messages
datetime_format = %b %d %H:%M:%S

[/var/log/user-data.log]
file = /var/log/user-data.log
log_group_name = /wedding-photo-processor/bootstrap
log_stream_name = {instance_id}/bootstrap
datetime_format = %Y-%m-%d %H:%M:%S

[/app/app.log]
file = /app/app.log
log_group_name = /wedding-photo-processor/application
log_stream_name = {instance_id}/application
datetime_format = %Y-%m-%d %H:%M:%S
CWCONF

# Configure region
sed -i 's/region = us-east-1/region = us-east-1/g' /etc/awslogs/awscli.conf

# Start CloudWatch Logs agent
systemctl enable awslogsd
systemctl start awslogsd

# Install Node.js 16.x
curl -fsSL https://rpm.nodesource.com/setup_16.x | bash -
yum install -y nodejs gcc-c++ make

# Verify Node.js installation
node --version
npm --version

echo "✅ Node.js $(node --version) installed successfully"

# Create application directory
mkdir -p /app
cd /app

# Create package.json with exact working versions
cat > package.json << 'EOF2'
{
  "name": "wedding-processor",
  "version": "1.0.0",
  "dependencies": {
    "express": "4.18.2",
    "@aws-sdk/client-sqs": "3.450.0",
    "@aws-sdk/client-s3": "3.450.0",
    "archiver": "5.3.2",
    "node-fetch": "2.7.0",
    "winston": "3.10.0",
    "winston-cloudwatch": "6.2.0"
  }
}
EOF2

echo "📦 Installing Node.js packages..."
npm install --production

echo "✅ npm install completed successfully"

# Create application with logging
cat > process.js << 'EOF3'
const express = require('express');
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const archiver = require('archiver');
const fs = require('fs');
const fetch = require('node-fetch');
const winston = require('winston');

// Setup logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'wedding-processor' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: '/app/app.log' })
  ]
});

// Add CloudWatch transport if needed
try {
  const WinstonCloudWatch = require('winston-cloudwatch');
  logger.add(new WinstonCloudWatch({
    logGroupName: '/wedding-photo-processor/application',
    logStreamName: `ec2-${Date.now()}`,
    awsRegion: 'us-east-1'
  }));
  logger.info('CloudWatch logging enabled');
} catch (error) {
  logger.warn('CloudWatch logging not available', { error: error.message });
}

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
    logger.info('Auto-shutting down due to inactivity');
    require('child_process').exec('sudo shutdown -h now');
  }
}, 60000);

// SQS Queue Polling for Wedding Processing Jobs
async function pollForJobs() {
  while (true) {
    try {
      logger.info('Polling SQS queue for wedding processing jobs...');
      
      const result = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20, // Long polling
        MessageAttributeNames: ['All']
      }));
      
      if (result.Messages && result.Messages.length > 0) {
        const message = result.Messages[0];
        const jobData = JSON.parse(message.Body);
        
        logger.info(`Received job for processing`, { 
          eventId: jobData.eventId, 
          photoCount: jobData.photos.length 
        });
        
        lastActivity = Date.now();
        isProcessing = true;
        
        try {
          // Process the wedding photos
          await processWeddingJob(jobData);
          
          // Delete message from queue
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          
          logger.info(`Job completed and removed from queue`, { eventId: jobData.eventId });
          isProcessing = false;
          lastActivity = Date.now();
        } catch (error) {
          logger.error(`Processing error`, { 
            eventId: jobData.eventId, 
            error: error.message,
            stack: error.stack
          });
          isProcessing = false;
          lastActivity = Date.now();
        }
      }
      
    } catch (error) {
      logger.error(`Queue polling error`, { error: error.message, stack: error.stack });
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
    }
  }
}

async function processWeddingJob(jobData) {
  const { eventId, email, photos } = jobData;
  
  logger.info(`Processing wedding collection`, { 
    eventId, 
    email, 
    photoCount: photos.length 
  });
  
  try {
    // Create a temporary directory for processing
    const tempDir = `/tmp/${eventId}`;
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download files
    const downloadedFiles = [];
    let totalDownloadedBytes = 0;
    
    logger.info(`Starting downloads`, { count: photos.length, eventId });
    
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      try {
        logger.info(`Downloading file ${i+1}/${photos.length}`, { 
          fileName: photo.fileName,
          url: photo.url?.substring(0, 100) + '...'
        });
        
        const filePath = `${tempDir}/${photo.fileName}`;
        const fileSize = await downloadFile(photo.url, filePath);
        downloadedFiles.push({
          path: filePath,
          fileName: photo.fileName,
          size: fileSize
        });
        totalDownloadedBytes += fileSize;
        
        logger.info(`Downloaded file ${i+1}/${photos.length}`, { 
          fileName: photo.fileName,
          sizeMB: (fileSize / 1024 / 1024).toFixed(2)
        });
      } catch (error) {
        logger.error(`Failed to download file`, { 
          fileName: photo.fileName, 
          error: error.message 
        });
      }
    }
    
    if (downloadedFiles.length === 0) {
      throw new Error('Failed to download any files');
    }
    
    const totalDownloadedMB = totalDownloadedBytes / 1024 / 1024;
    logger.info(`Download summary`, { 
      downloaded: downloadedFiles.length,
      total: photos.length,
      sizeMB: totalDownloadedMB.toFixed(2)
    });
    
    // Create zip archive
    logger.info(`Creating zip archive`, { eventId });
    const zipPath = `${tempDir}/${eventId}.zip`;
    await createZipArchive(downloadedFiles, zipPath);
    
    // Get zip file size
    const zipStats = fs.statSync(zipPath);
    const zipSizeMB = zipStats.size / 1024 / 1024;
    logger.info(`Zip archive created`, { 
      sizeMB: zipSizeMB.toFixed(2),
      eventId
    });
    
    // Upload to S3
    logger.info(`Uploading to S3`, { eventId });
    const s3Key = `wedding-photos/${eventId}/${Date.now()}.zip`;
    const s3Url = await uploadToS3(zipPath, s3Key);
    logger.info(`Uploaded to S3`, { url: s3Url, eventId });
    
    // Send email notification
    logger.info(`Sending email notification`, { email, eventId });
    await notifyEmailService(email, eventId, downloadedFiles.length, s3Url, zipSizeMB);
    
    // Clean up
    logger.info(`Cleaning up temporary files`, { eventId });
    fs.unlinkSync(zipPath);
    downloadedFiles.forEach(file => fs.unlinkSync(file.path));
    fs.rmdirSync(tempDir, { recursive: true });
    
    logger.info(`Wedding processing complete`, { 
      eventId,
      cost: '$0.01-0.02',
      savings: '95%'
    });
    
  } catch (error) {
    logger.error(`Processing error`, { 
      eventId, 
      error: error.message,
      stack: error.stack
    });
    // Notify about the error
    await notifyErrorOccurred(email, eventId, error.message);
    throw error; // Re-throw for proper handling
  }
}

async function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(downloadedBytes);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {}); // Delete the file if there's an error
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {}); // Delete the file if there's an error
      reject(err);
    });
  });
}

async function createZipArchive(files, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } }); // Balanced compression
    
    output.on('close', resolve);
    archive.on('error', reject);
    
    archive.pipe(output);
    
    for (const file of files) {
      archive.file(file.path, { name: file.fileName });
    }
    
    archive.finalize();
  });
}

async function uploadToS3(filePath, key) {
  const bucketName = 'wedding-photo-spot-1752995104'; // Replace with your actual bucket name
  const fileContent = fs.readFileSync(filePath);
  
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: fileContent,
    ContentType: 'application/zip'
  }));
  
  return `https://${bucketName}.s3.amazonaws.com/${key}`;
}

async function notifyEmailService(email, eventId, fileCount, downloadUrl, fileSizeMB) {
  // Try multiple notification endpoints in order of preference
  const notificationEndpoints = [
    {
      name: 'direct-email',
      url: 'https://main--sharedmoments.netlify.app/.netlify/functions/direct-email',
      source: 'aws-ec2-spot'
    },
    {
      name: 'cloudflare-worker',
      url: 'https://sharedmoments-photo-processor.migsub77.workers.dev/email',
      source: 'aws-ec2-spot'
    },
    {
      name: 'email-download',
      url: 'https://main--sharedmoments.netlify.app/.netlify/functions/email-download',
      source: 'aws-ec2-spot'
    }
  ];
  
  let notificationSent = false;
  let errors = [];
  
  for (const endpoint of notificationEndpoints) {
    if (notificationSent) break;
    
    try {
      logger.info(`Attempting to notify via ${endpoint.name}`, { email, eventId });
      
      const payload = {
        eventId,
        email,
        source: endpoint.source,
        downloadUrl,
        fileCount,
        finalSizeMB: fileSizeMB,
        processingTimeSeconds: 0,
        requestId: `ec2-spot-${Date.now()}`
      };
      
      const response = await fetch(endpoint.url, {
        method: 'post',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000 // 15 second timeout
      });
      
      if (response.ok) {
        logger.info(`Notification sent successfully via ${endpoint.name}`, { email, eventId });
        notificationSent = true;
        break;
      } else {
        const errorText = await response.text();
        throw new Error(`${endpoint.name} returned ${response.status}: ${errorText}`);
      }
    } catch (error) {
      logger.error(`Failed to notify via ${endpoint.name}`, { 
        error: error.message,
        email,
        eventId
      });
      errors.push(`${endpoint.name}: ${error.message}`);
    }
  }
  
  if (!notificationSent) {
    logger.error(`All notification methods failed`, { errors, email, eventId });
    throw new Error(`Failed to send email notification: ${errors.join('; ')}`);
  }
}

async function notifyErrorOccurred(email, eventId, errorMessage) {
  try {
    logger.info(`Notifying about error`, { email, eventId, errorMessage });
    
    const errorPayload = {
      eventId,
      email,
      error: errorMessage,
      isError: true,
      source: 'aws-ec2-spot'
    };
    
    // Try direct-email endpoint first
    const emailUrl = 'https://main--sharedmoments.netlify.app/.netlify/functions/direct-email';
    
    const response = await fetch(emailUrl, {
      method: 'post',
      body: JSON.stringify(errorPayload),
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000 // 15 second timeout
    });
    
    if (response.ok) {
      logger.info(`Error notification sent`, { email, eventId });
    } else {
      logger.error(`Failed to send error notification`, { 
        status: response.status,
        email,
        eventId
      });
    }
    
  } catch (error) {
    logger.error(`Error notification failed`, { 
      error: error.message,
      email,
      eventId
    });
    // Don't throw - this is just notification
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
    isProcessing: isProcessing,
    loggingEnabled: true
  });
});

// Manual processing endpoint (backup)
app.post('/process', async (req, res) => {
  lastActivity = Date.now();
  logger.info('Received direct processing request');
  
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
    logger.error('Processing error', { error: error.message, stack: error.stack });
    isProcessing = false;
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Debug endpoint to view logs
app.get('/logs', (req, res) => {
  lastActivity = Date.now();
  try {
    const logs = fs.readFileSync('/app/app.log', 'utf8');
    res.type('text/plain').send(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

const PORT = 8080;
app.listen(PORT, () => {
  logger.info(`Wedding photo processor running on port ${PORT}`);
  logger.info('Starting SQS queue polling for jobs...');
  logger.info('Processing 500MB videos cost-efficiently ($0.01-0.02 per job)!');
  
  // Start polling for jobs immediately
  pollForJobs().catch(error => {
    logger.error('Queue polling failed', { error: error.message, stack: error.stack });
  });
});
EOF3

node process.js
EOF

echo "✅ Created updated user-data script with CloudWatch Logs"

# Create IAM policy for CloudWatch Logs
cat > cloudwatch-logs-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/wedding-photo-processor/*",
        "arn:aws:logs:*:*:*"
      ]
    }
  ]
}
EOF

echo "✅ Created CloudWatch Logs IAM policy"

# Create script to update the instance profile
cat > update-instance-profile.sh << 'EOF'
#!/bin/bash
set -e

# Get the instance profile name
PROFILE_NAME=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=wedding-photo-processor" --query "Reservations[0].Instances[0].IamInstanceProfile.Arn" --output text | awk -F/ '{print $2}')

if [ -z "$PROFILE_NAME" ]; then
  echo "❌ No instance profile found for wedding-photo-processor"
  exit 1
fi

echo "✅ Found instance profile: $PROFILE_NAME"

# Create CloudWatch Logs policy
POLICY_ARN=$(aws iam create-policy --policy-name wedding-photo-cloudwatch-logs --policy-document file://cloudwatch-logs-policy.json --query "Policy.Arn" --output text)

echo "✅ Created policy: $POLICY_ARN"

# Attach policy to role
ROLE_NAME=$(aws iam get-instance-profile --instance-profile-name $PROFILE_NAME --query "InstanceProfile.Roles[0].RoleName" --output text)

echo "✅ Found role: $ROLE_NAME"

aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn $POLICY_ARN

echo "✅ Attached CloudWatch Logs policy to role"

echo "✅ Instance profile updated successfully"
EOF

chmod +x update-instance-profile.sh

echo "✅ Created script to update instance profile"

# Create script to launch new instance with CloudWatch Logs
cat > launch-instance-with-logs.sh << 'EOF'
#!/bin/bash
set -e

echo "🚀 Launching new EC2 Spot instance with CloudWatch Logs"

# Read the user-data script
USER_DATA=$(cat updated-user-data-with-logs.sh | base64)

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.medium \
  --key-name wedding-photo-spot-key \
  --security-group-ids sg-0179ab194345abc19 \
  --iam-instance-profile Name=wedding-photo-spot-profile \
  --user-data "$USER_DATA" \
  --instance-market-options 'MarketType=spot,SpotOptions={SpotInstanceType=one-time,InstanceInterruptionBehavior=terminate}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=wedding-photo-processor},{Key=Purpose,Value=500MB Video Processing},{Key=Cost,Value=~$0.01-0.02 per job},{Key=Auto-Shutdown,Value=10-minutes},{Key=Logging,Value=CloudWatch}]' \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "✅ Instance launched: $INSTANCE_ID"

# Wait for the instance to be running
echo "⏳ Waiting for instance to start..."
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

# Get the public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo "✅ Instance is running with IP: $PUBLIC_IP"
echo "🔍 You can check the health endpoint in about 1-2 minutes: http://$PUBLIC_IP:8080/health"
echo "📊 CloudWatch Logs will be available at: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/$252Fwedding-photo-processor"

# Send a test message to the queue
echo "📤 Sending a test message to the queue..."
curl -X POST https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-cloudwatch-logs",
    "email": "migsub77@gmail.com", 
    "photos": [
      {"fileName": "test-photo1.jpg", "url": "https://picsum.photos/800/600", "size": 500000},
      {"fileName": "test-photo2.jpg", "url": "https://picsum.photos/800/601", "size": 500000}
    ]
  }'

echo ""
echo "✅ Done! The instance should process the test message and send an email notification."
echo "📊 You can view the logs in CloudWatch: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups"
EOF

chmod +x launch-instance-with-logs.sh

echo "✅ Created script to launch instance with CloudWatch Logs"

# Create script to check CloudWatch Logs
cat > check-cloudwatch-logs.js << 'EOF'
const { CloudWatchLogsClient, DescribeLogGroupsCommand, GetLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

// Initialize CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });

async function checkCloudWatchLogs() {
  try {
    console.log('Checking CloudWatch Logs for wedding-photo-processor...');
    
    // List log groups
    const logGroupsCommand = new DescribeLogGroupsCommand({
      logGroupNamePrefix: '/wedding-photo-processor'
    });
    
    const logGroupsResponse = await logsClient.send(logGroupsCommand);
    
    if (!logGroupsResponse.logGroups || logGroupsResponse.logGroups.length === 0) {
      console.log('No log groups found with prefix /wedding-photo-processor');
      return;
    }
    
    console.log(`Found ${logGroupsResponse.logGroups.length} log groups:`);
    
    for (const logGroup of logGroupsResponse.logGroups) {
      console.log(`\nLog Group: ${logGroup.logGroupName}`);
      
      // Get log streams for this group
      const { DescribeLogStreamsCommand } = require('@aws-sdk/client-cloudwatch-logs');
      const logStreamsCommand = new DescribeLogStreamsCommand({
        logGroupName: logGroup.logGroupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 5
      });
      
      const logStreamsResponse = await logsClient.send(logStreamsCommand);
      
      if (!logStreamsResponse.logStreams || logStreamsResponse.logStreams.length === 0) {
        console.log('  No log streams found');
        continue;
      }
      
      console.log(`  Found ${logStreamsResponse.logStreams.length} log streams:`);
      
      // Get events from the most recent log stream
      const mostRecentStream = logStreamsResponse.logStreams[0];
      console.log(`  Most recent stream: ${mostRecentStream.logStreamName}`);
      
      const logEventsCommand = new GetLogEventsCommand({
        logGroupName: logGroup.logGroupName,
        logStreamName: mostRecentStream.logStreamName,
        limit: 20,
        startFromHead: false
      });
      
      const logEventsResponse = await logsClient.send(logEventsCommand);
      
      if (!logEventsResponse.events || logEventsResponse.events.length === 0) {
        console.log('  No log events found');
        continue;
      }
      
      console.log(`  Recent log events:`);
      logEventsResponse.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        console.log(`  [${timestamp}] ${event.message}`);
      });
    }
    
  } catch (error) {
    console.error('Error checking CloudWatch Logs:', error);
  }
}

// Check for a specific event ID
async function searchEventInLogs(eventId) {
  try {
    console.log(`\nSearching for event ID "${eventId}" in CloudWatch Logs...`);
    
    const logGroupNames = [
      '/wedding-photo-processor/application',
      '/wedding-photo-processor/system',
      '/wedding-photo-processor/bootstrap'
    ];
    
    for (const logGroupName of logGroupNames) {
      console.log(`\nSearching in log group: ${logGroupName}`);
      
      try {
        // Use FilterLogEvents to search across all streams
        const { FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
        const filterCommand = new FilterLogEventsCommand({
          logGroupName,
          filterPattern: eventId,
          limit: 100
        });
        
        const filterResponse = await logsClient.send(filterCommand);
        
        if (!filterResponse.events || filterResponse.events.length === 0) {
          console.log(`  No events found containing "${eventId}"`);
          continue;
        }
        
        console.log(`  Found ${filterResponse.events.length} events containing "${eventId}":`);
        filterResponse.events.forEach(event => {
          const timestamp = new Date(event.timestamp).toISOString();
          console.log(`  [${timestamp}] ${event.message}`);
        });
      } catch (error) {
        console.log(`  Error searching log group ${logGroupName}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(`Error searching for event ID "${eventId}":`, error);
  }
}

async function run() {
  await checkCloudWatchLogs();
  
  // If you want to search for a specific event ID, uncomment and modify this line
  // await searchEventInLogs('your-event-id');
}

run();
EOF

echo "✅ Created script to check CloudWatch Logs"

echo ""
echo "🚀 CloudWatch Logs setup complete!"
echo ""
echo "To enable CloudWatch Logs for EC2 instances:"
echo "1. Run ./update-instance-profile.sh to update IAM permissions"
echo "2. Run ./launch-instance-with-logs.sh to launch a new instance with logging"
echo "3. Run node check-cloudwatch-logs.js to check logs in CloudWatch"
echo ""
echo "After processing completes, you can search for your event ID in CloudWatch Logs:"
echo "- AWS Console: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups"
echo "- Or modify check-cloudwatch-logs.js to search for your event ID"
echo ""
echo "This setup will:"
echo "- Stream application logs to CloudWatch in real-time"
echo "- Preserve logs even after instance termination"
echo "- Allow searching logs by event ID or other criteria"
echo "- Provide a /logs endpoint on the EC2 instance for quick access"