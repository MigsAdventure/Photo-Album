#!/bin/bash
set -e

# Log all output for troubleshooting
exec 1>/var/log/user-data.log 2>&1

echo "Starting EC2 instance setup (modern streaming, ASCII-safe) at $(date)"

# Install Node.js (AL2023 has Node.js 20 in default repos)
# Skip system update to speed up bootstrap (takes 5+ minutes)
echo "Installing Node.js runtime and base tools..."
dnf install -y nodejs npm git htop amazon-cloudwatch-agent

echo "Node version: $(node -v || true)"
echo "NPM version: $(npm -v || true)"

# App directory
mkdir -p /app/logs
cd /app

# Fetch FIXED processor script from GitHub (includes all patches)
echo "Downloading fixed streaming processor script..."
curl -fSL -o /app/wedding-photo-processor-streaming.js https://raw.githubusercontent.com/MigsAdventure/Photo-Album/main/aws-ec2-spot/wedding-photo-processor-streaming-fixed.js

# Install production deps
echo "Installing npm packages..."
npm init -y
npm install --omit=dev @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/client-ec2 @aws-sdk/lib-storage express archiver

# Systemd service
cat > /etc/systemd/system/wedding-streaming-processor.service << 'SERVICE_EOF'
[Unit]
Description=Wedding Photo Streaming Processor (Node 18+ LTS)
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

# CloudWatch agent config
mkdir -p /opt/aws/amazon-cloudwatch-agent/etc
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CW_CONFIG'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/app/logs/processor.log", "log_group_name": "/wedding-photo-processor/application", "log_stream_name": "{instance_id}" },
          { "file_path": "/app/logs/processor-error.log", "log_group_name": "/wedding-photo-processor/error", "log_stream_name": "{instance_id}" },
          { "file_path": "/var/log/user-data.log", "log_group_name": "/wedding-photo-processor/bootstrap", "log_stream_name": "{instance_id}" }
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
