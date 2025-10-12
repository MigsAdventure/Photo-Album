#!/bin/bash
set -e

echo "🚀 Deploying EC2 instance for debugging zipping issues"

# Manually set the required environment variables
export R2_ACCOUNT_ID="98a9cce92e578cafdb9025fa24a6ee7e"
export R2_ACCESS_KEY_ID="06da59a3b3aa1315ed2c9a38efa7579e"
export R2_SECRET_ACCESS_KEY="e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27"
export R2_BUCKET_NAME="sharedmoments-photos-production"
export R2_PUBLIC_URL="https://sharedmomentsphotos.socialboostai.com"
export AWS_SQS_QUEUE_URL="https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue"
export AWS_REGION="us-east-1"
export NETLIFY_EMAIL_ENDPOINT="https://sharedmoments.socialboostai.com/.netlify/functions/direct-email"

echo "✅ Environment variables set"

# Check if user-data-debug.sh exists
if [ ! -f "user-data-debug.sh" ]; then
    echo "❌ user-data-debug.sh file not found"
    echo "Make sure the user-data-debug.sh file exists in the current directory"
    exit 1
fi

# Base64 encode the user-data script
USER_DATA_B64=$(base64 -i user-data-debug.sh)

# Generate a unique instance name
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
INSTANCE_NAME="wedding-photo-processor-debug-$TIMESTAMP"

echo "🚀 Launching EC2 instance: $INSTANCE_NAME"

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.medium \
  --key-name wedding-photo-spot-key \
  --security-group-ids sg-0179ab194345abc19 \
  --iam-instance-profile Name=wedding-photo-spot-profile \
  --user-data "$USER_DATA_B64" \
  --instance-market-options 'MarketType=spot,SpotOptions={SpotInstanceType=one-time,InstanceInterruptionBehavior=terminate}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=ProcessorType,Value=debug},{Key=Purpose,Value=Wedding Photo Processing Debug}]" \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "✅ Instance launched: $INSTANCE_ID"

# No cleanup needed - using external file

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
echo ""
echo "📋 To check logs, SSH into the instance:"
echo "   ssh -i wedding-photo-spot-key.pem ec2-user@$PUBLIC_IP"
echo "   sudo tail -f /var/log/user-data.log"
echo "   sudo tail -f /app/logs/processor.log"
echo "   sudo journalctl -u wedding-photo-processor -f"
