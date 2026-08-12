#!/bin/bash
set -e

# Enhanced logging
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "Starting EC2 instance setup at $(date)"

# Update and install dependencies
echo "Installing dependencies..."
yum update -y

# Enable Amazon Linux extras and install Node.js 16 (fully compatible with AL2)
amazon-linux-extras enable nodejs16
yum clean metadata
yum install -y nodejs git htop

# Create app directory
mkdir -p /app/logs
cd /app

# Download the processor script from GitHub
echo "Downloading processor script..."
curl -o wedding-photo-processor.js https://raw.githubusercontent.com/MigsAdventure/Photo-Album/main/aws-ec2-spot/wedding-photo-processor.js

# Install npm packages
echo "Installing npm packages..."
npm init -y
npm install @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/lib-storage express archiver node-fetch@2

# Create systemd service with logging
cat > /etc/systemd/system/wedding-photo-processor.service << 'SERVICE_EOF'
[Unit]
Description=Wedding Photo Processor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/app
ExecStart=/usr/bin/node /app/wedding-photo-processor.js
Restart=on-failure
RestartSec=10
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

# Enable CloudWatch logs
echo "Setting up CloudWatch logs..."
yum install -y amazon-cloudwatch-agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CW_CONFIG'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/app/logs/processor.log",
            "log_group_name": "/wedding-photo-processor/application",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/app/logs/processor-error.log",
            "log_group_name": "/wedding-photo-processor/error",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/wedding-photo-processor/bootstrap",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
CW_CONFIG

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
    -s

# Enable and start the service
systemctl daemon-reload
systemctl enable wedding-photo-processor
systemctl start wedding-photo-processor

# Set up enhanced logging script
cat > /app/monitor.sh << 'MONITOR_EOF'
#!/bin/bash
while true; do
    echo "=== $(date) ==="
    echo "Memory Usage:"
    free -m
    echo ""
    echo "Disk Usage:"
    df -h /tmp
    echo ""
    echo "Process Status:"
    ps aux | grep -E "(node|wedding)" | grep -v grep
    echo ""
    sleep 60
done
MONITOR_EOF
chmod +x /app/monitor.sh

# Run monitor in background
nohup /app/monitor.sh > /app/logs/monitor.log 2>&1 &

echo "Setup complete at $(date)"
echo "Service status:"
systemctl status wedding-photo-processor --no-pager

# Keep logs visible
tail -f /app/logs/processor.log /app/logs/processor-error.log
