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
        
        // Check if there's already a running instance
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
            
            console.log(`✅ Using existing instance: ${instanceId} (${publicIP})`);
            
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
                    message: 'Job queued - using existing EC2 instance',
                    instanceId: instanceId,
                    publicIP: publicIP,
                    estimatedCost: '$0.01-0.02',
                    processingTime: '2-3 minutes',
                    instanceType: 't3.medium (spot)',
                    eventId: eventId,
                    email: email,
                    photoCount: photos.length,
                    timestamp: new Date().toISOString(),
                    reusedInstance: true
                })
            };
        }
        
        // Launch EC2 Spot Instance
        const launchParams = {
            ImageId: 'ami-0c02fb55956c7d316', // Amazon Linux 2 AMI
            InstanceType: 't3.medium',
            MinCount: 1,
            MaxCount: 1,
            KeyName: process.env.KEY_NAME,
            IamInstanceProfile: {
                Name: process.env.INSTANCE_PROFILE
            },
            SecurityGroupIds: ['sg-0179ab194345abc19'], // Use default security group ID
            InstanceMarketOptions: {
                MarketType: 'spot',
                SpotOptions: {
                    SpotInstanceType: 'one-time',
                    InstanceInterruptionBehavior: 'terminate'
                }
            },
            UserData: fs.readFileSync(path.join(__dirname, 'user-data.sh')).toString('base64'),
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
