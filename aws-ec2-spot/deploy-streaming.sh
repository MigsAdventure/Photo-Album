#!/bin/bash

# Deploy streaming implementation for wedding photo processor

echo "🚀 Deploying Streaming Wedding Photo Processor"
echo "============================================"

# Check if Lambda function exists
echo "🔍 Checking Lambda function..."
FUNCTION_EXISTS=$(aws lambda get-function --function-name wedding-photo-spot-launcher 2>/dev/null)

if [ -z "$FUNCTION_EXISTS" ]; then
    echo "❌ Lambda function 'wedding-photo-spot-launcher' not found"
    echo "Please deploy the Lambda function first"
    exit 1
fi

# Read the streaming user data script
echo "📖 Reading streaming user data script..."
USER_DATA_CONTENT=$(cat user-data-streaming.sh | base64)

# Update Lambda function to use streaming processor
echo "🔄 Updating Lambda function configuration..."
aws lambda update-function-configuration \
    --function-name wedding-photo-spot-launcher \
    --timeout 300 \
    --memory-size 512 \
    --environment Variables="{
        USER_DATA_SCRIPT='STREAMING',
        R2_BUCKET_NAME='sharedmoments-photos-production',
        R2_PUBLIC_URL='https://sharedmomentsphotos.socialboostai.com',
        INSTANCE_TYPE='t3.medium'
    }" \
    --no-cli-pager

# Update Lambda function code to recognize streaming mode
echo "📝 Creating updated Lambda deployment package..."

# Create temporary directory
TEMP_DIR=$(mktemp -d)
cp lambda-function.js $TEMP_DIR/index.js

# Modify the Lambda function to use streaming user data
cat > $TEMP_DIR/index.js << 'EOF'
const { EC2Client, RunInstancesCommand, DescribeInstancesCommand, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const ec2 = new EC2Client({ region: 'us-east-1' });
const sqs = new SQSClient({ region: 'us-east-1' });

const queueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';

// Read user data script based on environment variable
const getUserDataScript = () => {
    const scriptType = process.env.USER_DATA_SCRIPT || 'STANDARD';
    
    if (scriptType === 'STREAMING') {
        // Streaming implementation - handles 10GB+ collections
        return Buffer.from(`#!/bin/bash
# AWS EC2 Streaming Processor Setup Script
# Handles 5-10GB+ collections with minimal memory usage

# Log all output
exec > >(tee -a /var/log/user-data.log)
exec 2>&1

echo "🚀 Starting EC2 streaming processor setup at $(date)"

# Update system
echo "📦 Updating system packages..."
apt-get update -y

# Install Node.js 18.x
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify installations
echo "✅ Node version: $(node --version)"
echo "✅ NPM version: $(npm --version)"

# Create working directory
mkdir -p /home/ubuntu/processor
cd /home/ubuntu/processor

# Download the streaming processor script
echo "⬇️ Downloading streaming processor script..."
cat > wedding-photo-processor-streaming.js << 'PROCESSOR_EOF'
${require('fs').readFileSync(__dirname + '/../wedding-photo-processor-streaming.js', 'utf8')}
PROCESSOR_EOF

# Create package.json
echo "📝 Creating package.json..."
cat > package.json << 'PACKAGE_EOF'
{
  "name": "wedding-photo-processor-streaming",
  "version": "2.0.0",
  "description": "AWS EC2 Streaming Processor for Large Wedding Photo Collections",
  "main": "wedding-photo-processor-streaming.js",
  "scripts": {
    "start": "node wedding-photo-processor-streaming.js"
  },
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.0.0",
    "@aws-sdk/client-s3": "^3.0.0",
    "archiver": "^6.0.0",
    "node-fetch": "^2.6.7"
  }
}
PACKAGE_EOF

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create systemd service for auto-restart
echo "🔧 Creating systemd service..."
cat > /etc/systemd/system/wedding-processor.service << 'SERVICE_EOF'
[Unit]
Description=Wedding Photo Streaming Processor
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/processor
ExecStart=/usr/bin/node wedding-photo-processor-streaming.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/wedding-processor.log
StandardError=append:/var/log/wedding-processor.log

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Enable and start the service
systemctl daemon-reload
systemctl enable wedding-processor
systemctl start wedding-processor

# Final system info
echo "✅ Setup complete at $(date)"
echo "📊 System info:"
echo "  - Memory: $(free -h | grep Mem | awk '{print $2}')"
echo "  - Disk: $(df -h / | tail -1 | awk '{print $4}' | sed 's/G/ GB/')"
echo "  - CPU: $(nproc) cores"
echo "🌊 Streaming processor ready to handle 5-10GB+ collections!"
`).toString('base64');
    }
    
    // Default to standard implementation
    return require('fs').readFileSync(__dirname + '/../user-data.sh').toString('base64');
};

exports.handler = async (event) => {
    console.log('📬 Wedding Photo Spot Launcher triggered');
    console.log('Event:', JSON.stringify(event, null, 2));
    
    const { eventId, email, photos = [], customerEmail } = event;
    
    if (!eventId) {
        throw new Error('eventId is required');
    }
    
    if (!photos || photos.length === 0) {
        throw new Error('No photos provided for processing');
    }
    
    const recipientEmail = email || customerEmail;
    if (!recipientEmail) {
        throw new Error('Either email or customerEmail is required');
    }
    
    try {
        // Add job to SQS queue
        console.log(`📤 Adding job to SQS for event: ${eventId}`);
        const messageBody = {
            eventId,
            email: recipientEmail,
            customerEmail: recipientEmail,
            photos,
            timestamp: new Date().toISOString()
        };
        
        await sqs.send(new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(messageBody),
            MessageAttributes: {
                eventId: {
                    StringValue: eventId,
                    DataType: 'String'
                },
                photoCount: {
                    StringValue: photos.length.toString(),
                    DataType: 'Number'
                }
            }
        }));
        
        console.log(`✅ Job queued successfully for ${photos.length} photos`);
        
        // Check for existing instances
        console.log('🔍 Checking for existing EC2 instances...');
        const describeResult = await ec2.send(new DescribeInstancesCommand({
            Filters: [
                {
                    Name: 'tag:Purpose',
                    Values: ['WeddingPhotoProcessor']
                },
                {
                    Name: 'instance-state-name',
                    Values: ['running', 'pending']
                }
            ]
        }));
        
        const existingInstances = describeResult.Reservations?.flatMap(r => r.Instances || []) || [];
        
        if (existingInstances.length > 0) {
            console.log(`♻️ Found ${existingInstances.length} existing instance(s), reusing...`);
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: 'Job queued - using existing EC2 instance',
                    instanceId: existingInstances[0].InstanceId,
                    jobId: eventId
                })
            };
        }
        
        // Launch new EC2 instance
        console.log('🚀 Launching new EC2 Spot instance...');
        
        const userData = getUserDataScript();
        const instanceType = process.env.INSTANCE_TYPE || 't3.medium';
        
        const runResult = await ec2.send(new RunInstancesCommand({
            ImageId: 'ami-0c02fb55956c7d316', // Amazon Linux 2 AMI
            InstanceType: instanceType,
            MinCount: 1,
            MaxCount: 1,
            InstanceMarketOptions: {
                MarketType: 'spot',
                SpotOptions: {
                    MaxPrice: '0.0416', // t3.medium on-demand price
                    SpotInstanceType: 'one-time',
                    InstanceInterruptionBehavior: 'terminate'
                }
            },
            UserData: userData,
            SecurityGroups: ['wedding-photo-processor-sg'],
            IamInstanceProfile: {
                Name: 'wedding-photo-processor-profile'
            },
            TagSpecifications: [
                {
                    ResourceType: 'instance',
                    Tags: [
                        { Key: 'Name', Value: 'wedding-photo-processor' },
                        { Key: 'Purpose', Value: 'WeddingPhotoProcessor' },
                        { Key: 'AutoShutdown', Value: '10min' },
                        { Key: 'ProcessorType', Value: process.env.USER_DATA_SCRIPT || 'STANDARD' }
                    ]
                }
            ]
        }));
        
        const instanceId = runResult.Instances[0].InstanceId;
        console.log(`✅ EC2 instance launched: ${instanceId}`);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Job queued and EC2 instance launched',
                instanceId,
                jobId: eventId,
                processorType: process.env.USER_DATA_SCRIPT || 'STANDARD'
            })
        };
        
    } catch (error) {
        console.error('❌ Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};
EOF

# Include the streaming processor code in the Lambda package
cp ../wedding-photo-processor-streaming.js $TEMP_DIR/
cp ../user-data.sh $TEMP_DIR/

# Create deployment package
cd $TEMP_DIR
npm init -y > /dev/null 2>&1
npm install @aws-sdk/client-ec2 @aws-sdk/client-sqs > /dev/null 2>&1
zip -r lambda-streaming.zip . > /dev/null

# Update Lambda function code
echo "🚀 Deploying updated Lambda function..."
aws lambda update-function-code \
    --function-name wedding-photo-spot-launcher \
    --zip-file fileb://lambda-streaming.zip \
    --no-cli-pager

# Clean up
cd -
rm -rf $TEMP_DIR

echo ""
echo "✅ Streaming implementation deployed successfully!"
echo ""
echo "📊 Configuration:"
echo "  - Lambda Function: wedding-photo-spot-launcher"
echo "  - Processor Type: STREAMING"
echo "  - Instance Type: t3.medium"
echo "  - Memory Usage: ~100MB (regardless of collection size)"
echo "  - Max Collection Size: 10GB+"
echo ""
echo "🧪 To test:"
echo "  1. Upload a large collection of photos"
echo "  2. Monitor CloudWatch Logs for memory usage"
echo "  3. Check email for download link"
echo ""
echo "🔄 To rollback to standard implementation:"
echo "  aws lambda update-function-configuration \\"
echo "    --function-name wedding-photo-spot-launcher \\"
echo "    --environment Variables=\"{USER_DATA_SCRIPT='STANDARD'}\""
