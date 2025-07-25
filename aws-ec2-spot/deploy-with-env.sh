#!/bin/bash
set -e

echo "🚀 Deploying EC2 Spot instance with environment variables"

# Load environment variables from .env file
if [ ! -f "../.env" ]; then
    echo "❌ .env file not found in parent directory"
    exit 1
fi

# Read environment variables
echo "📋 Loading environment variables from .env..."
source <(grep -v '^#' ../.env | grep -v '^$' | sed 's/^/export /')

# Validate required environment variables
REQUIRED_VARS=("R2_ACCOUNT_ID" "R2_ACCESS_KEY_ID" "R2_SECRET_ACCESS_KEY" "R2_BUCKET_NAME" "R2_PUBLIC_URL" "AWS_SQS_QUEUE_URL" "AWS_REGION")

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Missing required environment variable: $var"
        exit 1
    fi
done

echo "✅ Environment variables validated"

# Determine which user-data script to use
USER_DATA_FILE="user-data.sh"
PROCESSOR_TYPE="standard"

if [ "$1" = "streaming" ]; then
    USER_DATA_FILE="user-data-streaming.sh"
    PROCESSOR_TYPE="streaming"
fi

echo "📦 Using $PROCESSOR_TYPE processor with $USER_DATA_FILE"

# Create a temporary user-data script with environment variables injected
TEMP_USER_DATA=$(mktemp)
cp "$USER_DATA_FILE" "$TEMP_USER_DATA"

# Inject environment variables at the beginning of the script (after shebang)
sed -i.bak "2i\\
# Environment variables injected from .env\\
export R2_ACCOUNT_ID=\"$R2_ACCOUNT_ID\"\\
export R2_ACCESS_KEY_ID=\"$R2_ACCESS_KEY_ID\"\\
export R2_SECRET_ACCESS_KEY=\"$R2_SECRET_ACCESS_KEY\"\\
export R2_BUCKET_NAME=\"$R2_BUCKET_NAME\"\\
export R2_PUBLIC_URL=\"$R2_PUBLIC_URL\"\\
export AWS_SQS_QUEUE_URL=\"$AWS_SQS_QUEUE_URL\"\\
export AWS_REGION=\"$AWS_REGION\"\\
export NETLIFY_EMAIL_ENDPOINT=\"https://sharedmoments.socialboostai.com/.netlify/functions/direct-email\"\\
" "$TEMP_USER_DATA"

# Base64 encode the user-data script
USER_DATA_B64=$(base64 -i "$TEMP_USER_DATA")

# Generate a unique instance name
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
INSTANCE_NAME="wedding-photo-processor-$PROCESSOR_TYPE-$TIMESTAMP"

echo "🚀 Launching EC2 Spot instance: $INSTANCE_NAME"

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.medium \
  --key-name wedding-photo-spot-key \
  --security-group-ids sg-0179ab194345abc19 \
  --iam-instance-profile Name=wedding-photo-spot-profile \
  --user-data "$USER_DATA_B64" \
  --instance-market-options 'MarketType=spot,SpotOptions={SpotInstanceType=one-time,InstanceInterruptionBehavior=terminate}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=ProcessorType,Value=$PROCESSOR_TYPE},{Key=Purpose,Value=Wedding Photo Processing},{Key=Cost,Value=~\$0.01-0.02 per job},{Key=Auto-Shutdown,Value=10-15 minutes}]" \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "✅ Instance launched: $INSTANCE_ID"

# Clean up temporary file
rm "$TEMP_USER_DATA"
rm "${TEMP_USER_DATA}.bak"

# Wait for the instance to be running
echo "⏳ Waiting for instance to start..."
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

# Get the public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo "✅ Instance is running with IP: $PUBLIC_IP"
echo "🔍 Health endpoint will be available in about 2-3 minutes: http://$PUBLIC_IP:8080/health"

# Optional: Send a test message to the queue
if [ "$2" = "test" ]; then
    echo "📤 Sending a test message to the queue..."
    curl -X POST https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/ \
      -H "Content-Type: application/json" \
      -d '{
        "eventId": "'$TIMESTAMP'_deployment_test",
        "email": "test@example.com", 
        "photos": [
          {"fileName": "test-photo1.jpg", "url": "https://picsum.photos/800/600", "size": 500000},
          {"fileName": "test-photo2.jpg", "url": "https://picsum.photos/800/601", "size": 500000}
        ]
      }'
    echo ""
    echo "✅ Test message sent! The instance should process it and send an email notification."
fi

echo ""
echo "🎉 Deployment complete!"
echo "📊 Instance Details:"
echo "   - Instance ID: $INSTANCE_ID"
echo "   - Public IP: $PUBLIC_IP"
echo "   - Processor Type: $PROCESSOR_TYPE"
echo "   - Health Check: http://$PUBLIC_IP:8080/health"
echo ""
echo "Usage examples:"
echo "   ./deploy-with-env.sh                 # Deploy standard processor"
echo "   ./deploy-with-env.sh streaming       # Deploy streaming processor"
echo "   ./deploy-with-env.sh streaming test  # Deploy streaming processor and send test"
