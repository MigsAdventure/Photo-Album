#!/bin/bash
set -euo pipefail

echo "🚀 Deploying EC2 Spot instance with modern streaming processor (Node 22)"
echo "======================================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Validate prerequisites
if ! command -v aws >/dev/null 2>&1; then
  echo "❌ AWS CLI not found. Please install and configure AWS CLI."
  exit 1
fi

echo "🔐 Verifying AWS credentials..."
aws sts get-caller-identity >/dev/null

USER_DATA_FILE="$SCRIPT_DIR/user-data-modern-streaming-ascii.sh"
if [ ! -f "$USER_DATA_FILE" ]; then
  echo "❌ user-data-modern-streaming.sh not found at $USER_DATA_FILE"
  exit 1
fi

# Config (reuse known-good resources from existing scripts)
AMI_ID="ami-0c02fb55956c7d316"               # Amazon Linux 2 AMI (us-east-1)
INSTANCE_TYPE="t3.medium"
KEY_NAME="wedding-photo-spot-key"
SECURITY_GROUP_ID="sg-0179ab194345abc19"
IAM_INSTANCE_PROFILE="wedding-photo-spot-profile"

# Base64 user-data
echo "📦 Using user-data file directly (AWS CLI will base64-encode)..."

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
INSTANCE_NAME="wedding-photo-processor-modern-$TIMESTAMP"

echo "🚀 Launching EC2 Spot instance: $INSTANCE_NAME"
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SECURITY_GROUP_ID" \
  --iam-instance-profile Name="$IAM_INSTANCE_PROFILE" \
  --user-data file://"$USER_DATA_FILE" \
  --instance-market-options 'MarketType=spot,SpotOptions={SpotInstanceType=one-time,InstanceInterruptionBehavior=terminate}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=Purpose,Value=Wedding Photo Processing},{Key=ProcessorType,Value=streaming-modern}]" \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "✅ Instance launched: $INSTANCE_ID"
echo "⏳ Waiting for instance to enter 'running' state..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo "✅ Instance is running with IP: $PUBLIC_IP"
echo "🔍 Health endpoint (available in ~2-3 minutes): http://$PUBLIC_IP:8080/health"
echo ""
echo "📋 To check logs via SSH:"
echo "   ssh -i $SCRIPT_DIR/wedding-photo-spot-key.pem ec2-user@$PUBLIC_IP"
echo "   sudo tail -f /var/log/user-data.log"
echo "   sudo tail -f /app/logs/processor.log /app/logs/processor-error.log"
echo "   sudo journalctl -u wedding-streaming-processor -f"
echo ""
echo "🧪 To enqueue a test job, use your existing test scripts (e.g., test-ec2-processing.js) or send to SQS:"
echo "   node test-ec2-processing.js"
