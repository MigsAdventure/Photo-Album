const { EC2Client, RunInstancesCommand, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const fs = require('fs');
const path = require('path');

// AWS EC2 Spot Instance Launcher for 500MB Wedding Videos
// Ultra Cost-Efficient: ~$0.01-0.02 per job vs $0.80+ for Lambda

exports.handler = async (event) => {
    console.log('🚀 AWS EC2 Spot Launcher triggered for 500MB video processing');
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    const ec2 = new EC2Client({ region: process.env.AWS_REGION || 'us-east-1' });
    
    try {
        // Parse event data - handle both direct invocation and HTTP requests
        let requestData;
        
        if (event.httpMethod || event.requestContext) {
            // HTTP request from Function URL
            if (event.body) {
                requestData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
            } else {
                return {
                    statusCode: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    },
                    body: JSON.stringify({
                        success: false,
                        error: 'Request body is required'
                    })
                };
            }
        } else {
            // Direct Lambda invocation
            requestData = event;
        }
        
        const { eventId, email, photos = [] } = requestData;
        
        if (!eventId || !email) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'eventId and email are required'
                })
            };
        }
        
        console.log(`📊 Processing request: eventId=${eventId}, email=${email}, photos=${photos.length}`);
        
        // First, queue the job data for EC2 to process when ready
        const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
        const queueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';
        
        const jobData = {
            eventId,
            email,
            photos,
            requestId: requestData.requestId || `req_${Date.now()}`,
            timestamp: new Date().toISOString(),
            priority: photos.length > 10 ? 'high' : 'normal'
        };
        
        console.log('📤 Queueing job data for EC2 processing...');
        await sqs.send(new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(jobData),
            MessageAttributes: {
                'eventId': {
                    DataType: 'String',
                    StringValue: eventId
                },
                'photoCount': {
                    DataType: 'Number',
                    StringValue: photos.length.toString()
                }
            }
        }));
        
        console.log(`✅ Job queued successfully for eventId: ${eventId}`);
        
        // Check if there's already a running instance to avoid launching duplicates
        // But we let instances auto-terminate when idle instead of reusing them
        const describeParams = {
            Filters: [
                { Name: 'tag:Name', Values: ['wedding-photo-processor'] },
                { Name: 'instance-state-name', Values: ['running', 'pending'] }
            ]
        };
        
        const existingInstances = await ec2.send(new DescribeInstancesCommand(describeParams));
        const runningInstances = existingInstances.Reservations.flatMap(r => r.Instances || []);
        
        if (runningInstances.length > 0) {
            const instanceId = runningInstances[0].InstanceId;
            const publicIP = runningInstances[0].PublicIpAddress;
            const launchTime = runningInstances[0].LaunchTime;
            const instanceAge = Date.now() - new Date(launchTime).getTime();
            
            console.log(`ℹ️ Found existing instance: ${instanceId} (age: ${Math.round(instanceAge / 1000 / 60)}min)`);
            
            // If instance is young (< 2 minutes), it's likely still starting up, so don't launch another
            if (instanceAge < 120000) {
                console.log(`⏳ Instance is still starting up, not launching another`);
                
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    },
                    body: JSON.stringify({
                        success: true,
                        message: 'Job queued - instance is starting up',
                        instanceId: instanceId,
                        publicIP: publicIP,
                        estimatedCost: '$0.01-0.02',
                        processingTime: '2-3 minutes',
                        instanceType: 't3.medium (spot)',
                        eventId: eventId,
                        email: email,
                        photoCount: photos.length,
                        timestamp: new Date().toISOString(),
                        existingInstance: true
                    })
                };
            }
            
            // If instance is older, it's processing jobs. The existing instance will handle the queued job.
            console.log(`✅ Active instance found - job will be processed from queue`);
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                body: JSON.stringify({
                    success: true,
                    message: 'Job queued - existing instance will process',
                    instanceId: instanceId,
                    publicIP: publicIP,
                    estimatedCost: '$0.01-0.02',
                    processingTime: '2-3 minutes',
                    instanceType: 't3.medium (spot)',
                    eventId: eventId,
                    email: email,
                    photoCount: photos.length,
                    timestamp: new Date().toISOString(),
                    activeInstance: true,
                    note: 'Instance will auto-terminate after 5min of inactivity'
                })
            };
        }
        
        // User-data script for AL2023 with fixed streaming processor
        const userDataScript = `#!/bin/bash
set -e
exec 1>/var/log/user-data.log 2>&1
echo "Starting EC2 instance setup at $(date)"
dnf install -y nodejs npm git htop amazon-cloudwatch-agent
echo "Node version: $(node -v || true)"
echo "NPM version: $(npm -v || true)"
mkdir -p /app/logs
cd /app
curl -fSL -o /app/wedding-photo-processor-streaming.js https://raw.githubusercontent.com/MigsAdventure/Photo-Album/main/aws-ec2-spot/wedding-photo-processor-streaming-fixed.js
npm init -y
npm install --omit=dev @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/client-ec2 @aws-sdk/lib-storage express archiver
cat > /etc/systemd/system/wedding-streaming-processor.service << 'SERVICE_EOF'
[Unit]
Description=Wedding Photo Streaming Processor
After=network.target
[Service]
Type=simple
User=root
WorkingDirectory=/app
ExecStart=/usr/bin/node /app/wedding-photo-processor-streaming.js
Restart=always
RestartSec=10
StandardOutput=append:/app/logs/processor.log
StandardError=append:/app/logs/processor-error.log
TimeoutStopSec=120
KillMode=process
Environment="NODE_ENV=production"
Environment="R2_ACCOUNT_ID=98a9cce92e578cafdb9025fa24a6ee7e"
Environment="R2_ACCESS_KEY_ID=06da59a3b3aa1315ed2c9a38efa7579e"
Environment="R2_SECRET_ACCESS_KEY=e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27"
Environment="R2_BUCKET_NAME=sharedmoments-photos-production"
Environment="R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com"
Environment="AWS_SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue"
Environment="AWS_REGION=us-east-1"
Environment="NETLIFY_EMAIL_ENDPOINT=https://sharedmoments.socialboostai.com/.netlify/functions/direct-email"
[Install]
WantedBy=multi-user.target
SERVICE_EOF
systemctl daemon-reload
systemctl enable wedding-streaming-processor
systemctl start wedding-streaming-processor
echo "Setup complete at $(date)"`;
        
        // Launch EC2 Spot Instance
        const launchParams = {
            ImageId: 'ami-052064a798f08f0d3', // Amazon Linux 2023 AMI (supports Node.js 20)
            InstanceType: 't3.medium',
            MinCount: 1,
            MaxCount: 1,
            KeyName: 'wedding-photo-spot-key',
            IamInstanceProfile: {
                Name: 'wedding-photo-processor-profile'
            },
            SecurityGroupIds: ['sg-0179ab194345abc19'],
            InstanceMarketOptions: {
                MarketType: 'spot',
                SpotOptions: {
                    SpotInstanceType: 'one-time',
                    InstanceInterruptionBehavior: 'terminate'
                }
            },
            UserData: Buffer.from(userDataScript).toString('base64'),
            TagSpecifications: [{
                ResourceType: 'instance',
                Tags: [
                    { Key: 'Name', Value: 'wedding-photo-processor' },
                    { Key: 'Purpose', Value: '500MB Video Processing' },
                    { Key: 'Cost', Value: '~$0.01-0.02 per job' },
                    { Key: 'Auto-Shutdown', Value: '10-minutes' }
                ]
            }]
        };
        
        console.log('🚀 Launching EC2 Spot instance for 500MB video processing...');
        const result = await ec2.send(new RunInstancesCommand(launchParams));
        const instanceId = result.Instances[0].InstanceId;
        
        console.log(`✅ EC2 Spot instance launched: ${instanceId}`);
        console.log(`💰 Cost: ~$0.01-0.02 for this job (95% savings vs current solution)`);
        
        // Wait a moment for instance to start
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Get instance details
        const describeResult = await ec2.send(new DescribeInstancesCommand({
            InstanceIds: [instanceId]
        }));
        
        const instance = describeResult.Reservations[0]?.Instances[0];
        const publicIP = instance?.PublicIpAddress;
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({
                success: true,
                message: 'EC2 Spot instance launched for 500MB video processing',
                instanceId: instanceId,
                publicIP: publicIP,
                estimatedCost: '$0.01-0.02',
                processingTime: '2-3 minutes',
                instanceType: 't3.medium (spot)',
                eventId: eventId,
                email: email,
                photoCount: photos.length,
                timestamp: new Date().toISOString()
            })
        };
        
    } catch (error) {
        console.error('❌ Error launching EC2 Spot instance:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({
                success: false,
                error: error.message,
                errorType: error.name,
                message: 'Failed to launch EC2 Spot instance for 500MB video processing'
            })
        };
    }
};
