#!/bin/bash
set -e

# Log all output for troubleshooting
exec 1>/var/log/user-data.log 2>&1

echo "Starting EC2 instance setup (with auto-termination fix) at $(date)"

# Update base packages first to avoid repo/key issues
yum update -y

# Install Node.js (prefer Node 20; fallback to Node 18)
echo "Installing Node.js runtime and base tools..."
if ! curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -; then
  echo "NodeSource setup_20.x failed; trying Node 18"
  curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
fi
yum install -y nodejs git htop amazon-cloudwatch-agent

echo "Node version: $(node -v || true)"
echo "NPM version: $(npm -v || true)"

# App directory
mkdir -p /app/logs
cd /app

# Fetch the FIXED processor script from GitHub
echo "Downloading fixed streaming processor script..."
curl -fSL -o /app/wedding-photo-processor-streaming.js https://raw.githubusercontent.com/MigsAdventure/Photo-Album/main/aws-ec2-spot/wedding-photo-processor-streaming-fixed.js

# Install production deps (including EC2 client for auto-termination)
echo "Installing npm packages..."
npm init -y
npm install --omit=dev @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/client-ec2 @aws-sdk/lib-storage express archiver

# Systemd service with NO restart on success (exit code 0)
cat > /etc/systemd/system/wedding-streaming-processor.service << 'SERVICE_EOF'
[Unit]
Description=Wedding Photo Streaming Processor (Auto-Terminate)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/app
ExecStart=/usr/bin/node /app/wedding-photo-processor-streaming.js
Restart=on-failure
RestartSec=10
SuccessExitStatus=0
StandardOutput=append:/app/logs/processor.log
StandardError=append:/app/logs/processor-error.log
Environment="NODE_ENV=production"
Environment="R2_ACCOUNT_ID=${R2_ACCOUNT_ID}"
Environment="R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}"
Environment="R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}"
Environment="R2_BUCKET_NAME=sharedmoments-photos-production"
Environment="R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com"
Environment="AWS_SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue"
Environment="AWS_REGION=us-east-1"
Environment="NETLIFY_EMAIL_ENDPOINT=https://sharedmoments.socialboostai.com/.netlify/functions/direct-email"

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# CloudWatch agent config
mkdir -p /opt/aws/amazon-cloudwatch-agent/etc
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CW_CONFIG'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/app/logs/processor.log", "log_group_name": "/wedding-photo-processor/application", "log_stream_name": "{instance_id}-fixed" },
          { "file_path": "/app/logs/processor-error.log", "log_group_name": "/wedding-photo-processor/error", "log_stream_name": "{instance_id}-fixed" },
          { "file_path": "/var/log/user-data.log", "log_group_name": "/wedding-photo-processor/bootstrap", "log_stream_name": "{instance_id}-fixed" }
        ]
      }
    }
  }
}
CW_CONFIG

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

# Enable and start service
systemctl daemon-reload
systemctl enable wedding-streaming-processor
systemctl start wedding-streaming-processor

echo "Setup complete at $(date)"
systemctl status wedding-streaming-processor --no-pager || true

# Keep logs visible
tail -f /app/logs/processor.log /app/logs/processor-error.log
