const { EC2Client, RunInstancesCommand, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// AWS EC2 Spot Instance Launcher for 500MB Wedding Videos
// Ultra Cost-Efficient: ~$0.01-0.02 per job vs $0.80+ for Lambda
//
// SECURITY (finding SEC-3)
// ------------------------
// This runs behind a Lambda Function URL with AuthType NONE, and its address is
// committed in cloudflare-worker/wrangler.toml and three test scripts. Until
// this change it accepted any POST: anyone who found the URL could queue jobs
// and launch EC2 instances on our account indefinitely, and have email sent from
// our domain to any address they chose. That is a denial-of-wallet endpoint.
//
// Callers must now present LAUNCHER_SHARED_SECRET in x-sharedmoments-secret.
// The Cloudflare Worker sends it from its own secret binding.
//
// The shared secret is a stopgap that can ship without touching IAM. The better
// control is switching the Function URL to AuthType AWS_IAM and signing requests
// with SigV4 from the Worker, which removes the standing credential entirely.
// See docs/runbooks/lambda-url-auth.md.

const MAX_CONCURRENT_INSTANCES = Number(process.env.MAX_CONCURRENT_INSTANCES || 2);

/**
 * Read a required value from the Lambda's environment (finding SEC-9).
 *
 * The user-data script below is a systemd unit file, and it used to carry live
 * R2 credentials as string literals — committed to this repository, in seven
 * files, across two different key pairs. Anyone with repository access held
 * read, write and delete on the production photo bucket.
 *
 * Configure these in the Lambda's own environment variables instead, where they
 * can be rotated without a code change. Throwing on a missing value is
 * deliberate: silently baking an empty credential into an instance produces a
 * processor that starts, polls the queue, and fails every job with an opaque
 * auth error.
 */
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} is not set on the launcher Lambda. The processor cannot be ` +
            `configured without it. See docs/runbooks/credential-rotation.md.`
        );
    }
    return value;
}

/** Constant-time comparison so the secret cannot be recovered by timing. */
function safeEquals(a, b) {
    const bufA = Buffer.from(String(a || ''), 'utf8');
    const bufB = Buffer.from(String(b || ''), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/** Case-insensitive header lookup — API Gateway and Function URLs differ. */
function getHeader(headers, name) {
    if (!headers) return undefined;
    const target = name.toLowerCase();
    const key = Object.keys(headers).find(k => k.toLowerCase() === target);
    return key ? headers[key] : undefined;
}

/**
 * Reject callers who cannot prove they hold the shared secret.
 * Returns null when the request is authorised, or a response to return.
 */
function rejectIfUnauthorised(event) {
    // Direct Lambda invocations (no HTTP envelope) already required IAM
    // permission to call InvokeFunction, so they are trusted.
    const isHttp = Boolean(event.httpMethod || event.requestContext);
    if (!isHttp) return null;

    const expected = process.env.LAUNCHER_SHARED_SECRET;

    if (!expected) {
        // Fail closed. An unset secret must not mean "accept everything" —
        // that is the vulnerability being fixed.
        console.error('LAUNCHER_SHARED_SECRET is not set; refusing all HTTP requests');
        return { statusCode: 503, body: JSON.stringify({ error: 'Service unavailable' }) };
    }

    const presented = getHeader(event.headers, 'x-sharedmoments-secret');

    if (!presented || !safeEquals(presented, expected)) {
        console.warn('Rejected unauthenticated launcher request');
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    return null;
}

exports.handler = async (event) => {
    console.log('🚀 AWS EC2 Spot Launcher triggered for 500MB video processing');

    const unauthorised = rejectIfUnauthorised(event);
    if (unauthorised) return unauthorised;

    // Only logged after authentication, and without headers — the request
    // carries a shared secret and the body carries customer email addresses.
    console.log('Authenticated launcher request received');

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

        // Hard ceiling on concurrent processors (SEC-3). Without this, a burst
        // of requests - malicious or a retry storm - launches an unbounded
        // number of instances. The job is already safely queued in SQS at this
        // point, so refusing to launch costs latency, not the job.
        if (runningInstances.length >= MAX_CONCURRENT_INSTANCES) {
            console.warn(`At instance cap (${runningInstances.length}/${MAX_CONCURRENT_INSTANCES}); job stays queued`);

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, x-sharedmoments-secret'
                },
                body: JSON.stringify({
                    success: true,
                    message: 'Job queued - processing capacity is full, an existing instance will pick it up',
                    eventId: eventId,
                    queued: true,
                    atCapacity: true
                })
            };
        }

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
Restart=on-failure
RestartSec=10
StandardOutput=append:/app/logs/processor.log
StandardError=append:/app/logs/processor-error.log
TimeoutStopSec=120
KillMode=process
SuccessExitStatus=0
Environment="NODE_ENV=production"
Environment="R2_ACCOUNT_ID=${requireEnv('R2_ACCOUNT_ID')}"
Environment="R2_ACCESS_KEY_ID=${requireEnv('R2_ACCESS_KEY_ID')}"
Environment="R2_SECRET_ACCESS_KEY=${requireEnv('R2_SECRET_ACCESS_KEY')}"
Environment="R2_BUCKET_NAME=${requireEnv('R2_BUCKET_NAME')}"
Environment="R2_PUBLIC_URL=${requireEnv('R2_PUBLIC_URL')}"
Environment="AWS_SQS_QUEUE_URL=${requireEnv('AWS_SQS_QUEUE_URL')}"
Environment="AWS_REGION=${process.env.AWS_REGION || 'us-east-1'}"
Environment="NETLIFY_EMAIL_ENDPOINT=${requireEnv('NETLIFY_EMAIL_ENDPOINT')}"
Environment="INTERNAL_SERVICE_SECRET=${requireEnv('INTERNAL_SERVICE_SECRET')}"
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
            // The processor now stages each file to a temp file before adding it
            // to the archive, so a dropped connection costs one retry instead of
            // the whole job (finding ZIP-3). Only one file is on disk at a time,
            // but a single file can be 2 GB, and the AL2023 AMI default root
            // volume is 8 GB before the OS and node_modules. 30 GB gp3 costs
            // pennies for the few minutes an instance lives and removes the
            // failure mode entirely.
            BlockDeviceMappings: [
                {
                    DeviceName: '/dev/xvda',
                    Ebs: {
                        VolumeSize: 30,
                        VolumeType: 'gp3',
                        DeleteOnTermination: true
                    }
                }
            ],
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
