#!/bin/bash

# Deployment script for EC2 Spot instance with Amazon Linux 2023 and auto-termination
echo "🚀 Deploying Wedding Photo Processor EC2 Spot Instance (AL2023 with auto-termination)..."

# Configuration
AMI_ID="ami-0de716d6197524dd9"  # Amazon Linux 2023 (us-east-1)
INSTANCE_TYPE="t3.medium"
KEY_NAME="wedding-photo-spot-key"
SECURITY_GROUP_ID="sg-0179ab194345abc19"
SPOT_PRICE="0.0416"  # t3.medium spot price
USER_DATA_FILE="aws-ec2-spot/user-data-al2023-auto-terminate.sh"

# Check if user data file exists
if [ ! -f "$USER_DATA_FILE" ]; then
    echo "❌ User data file not found: $USER_DATA_FILE"
    exit 1
fi

# Base64 encode the user data
USER_DATA_ENCODED=$(base64 < "$USER_DATA_FILE")

# Create spot instance request
echo "📝 Creating spot instance request..."
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type $INSTANCE_TYPE \
  --key-name $KEY_NAME \
  --security-group-ids $SECURITY_GROUP_ID \
  --instance-market-options "MarketType=spot,SpotOptions={MaxPrice=$SPOT_PRICE,SpotInstanceType=one-time,InstanceInterruptionBehavior=terminate}" \
  --iam-instance-profile Name=wedding-photo-spot-profile \
  --user-data "$USER_DATA_ENCODED" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=wedding-photo-processor-fixed-$(date +%Y%m%d-%H%M%S)}]" \
  --region us-east-1 \
  --query 'Instances[0].InstanceId' \
  --output text)

if [ -z "$INSTANCE_ID" ]; then
    echo "❌ Failed to create instance"
    exit 1
fi

echo "✅ Instance created: $INSTANCE_ID"

# Wait for instance to be running
echo "⏳ Waiting for instance to start..."
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region us-east-1

# Get instance details
INSTANCE_INFO=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region us-east-1 --query 'Reservations[0].Instances[0]')
✅ EC2 Spot Instance Deployed (WITH AUTO-TERMINATION FIX)
PUBLIC_IP=$(echo $INSTANCE_INFO | jq -r '.PublicIpAddress')
PRIVATE_IP=$(echo $INSTANCE_INFO | jq -r '.PrivateIpAddress')

echo "
✅ EC2 Spot Instance Deployed (AL2023 with Node.js 20+)
========================================
✅ EC2 Spot Instance Deployed (WITH AUTO-TERMINATION FIX)
========================================
Instance ID: $INSTANCE_ID
Public IP: $PUBLIC_IP
Private IP: $PRIVATE_IP
Instance Type: $INSTANCE_TYPE
Spot Price: $SPOT_PRICE
AMI: Amazon Linux 2023

Key Features:
- Node.js 20+ support
- Auto-terminates after 15 minutes idle
- Improved large file handling (300MB+)
- Better error recovery and logging
- CloudWatch log streams ending in '-fixed'

Health Check (wait 2-3 minutes):
curl http://$PUBLIC_IP:8080/health

CloudWatch Logs:
- /wedding-photo-processor/application (stream: ${INSTANCE_ID}-fixed)
- /wedding-photo-processor/error (stream: ${INSTANCE_ID}-fixed)
- /wedding-photo-processor/bootstrap (stream: ${INSTANCE_ID}-fixed)

SSH Access:
ssh -i aws-ec2-spot/wedding-photo-spot-key.pem ec2-user@$PUBLIC_IP

Monitor Logs:
aws logs tail /wedding-photo-processor/application --follow --region us-east-1 --filter-pattern '\"${INSTANCE_ID}-fixed\"'
========================================
"
