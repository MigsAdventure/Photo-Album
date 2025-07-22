#!/bin/bash
set -e

echo "🚀 Launching new EC2 Spot instance with updated code"

# Read the user-data script
USER_DATA=$(cat /Users/mig/code/wedding-photo-app/aws-ec2-spot/updated-user-data.sh | base64)

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.medium \
  --key-name wedding-photo-spot-key \
  --security-group-ids sg-0179ab194345abc19 \
  --iam-instance-profile Name=wedding-photo-spot-profile \
  --user-data "$USER_DATA" \
  --instance-market-options 'MarketType=spot,SpotOptions={SpotInstanceType=one-time,InstanceInterruptionBehavior=terminate}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=wedding-photo-processor},{Key=Purpose,Value=500MB Video Processing},{Key=Cost,Value=~$0.01-0.02 per job},{Key=Auto-Shutdown,Value=10-minutes}]' \
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

# Send a test message to the queue
echo "📤 Sending a test message to the queue..."
curl -X POST https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "2025-07-25_new_instance_test",
    "email": "test@example.com", 
    "photos": [
      {"fileName": "wedding-photo1.jpg", "url": "https://picsum.photos/800/600", "size": 500000},
      {"fileName": "wedding-photo2.jpg", "url": "https://picsum.photos/800/601", "size": 500000}
    ]
  }'

echo ""
echo "✅ Done! The instance should process the test message and send an email notification."