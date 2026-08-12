#!/bin/bash

# User data script that pulls latest code from GitHub
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
echo "Starting EC2 instance setup at $(date)"

# Update system
dnf update -y

# Install dependencies
echo "Installing Node.js 20 and required packages..."
dnf install -y nodejs npm git aws-cli

# Clone repository to get latest code
cd /home/ec2-user
echo "Cloning repository from GitHub..."
git clone https://github.com/MigsAdventure/Photo-Album.git wedding-processor
cd wedding-processor/aws-ec2-spot

# Install dependencies
npm install

# Create systemd service
cat > /etc/systemd/system/wedding-streaming-processor.service << 'EOF'
[Unit]
Description=Wedding Photo Streaming Processor
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/wedding-processor/aws-ec2-spot
ExecStart=/usr/bin/node wedding-photo-processor-streaming-fixed.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=wedding-processor

Environment="AWS_REGION=us-east-1"
Environment="NODE_ENV=production"
Environment="R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}"
Environment="R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}"
Environment="R2_BUCKET_NAME=miguels-wedding-photos"
Environment="R2_ACCOUNT_ID=${R2_ACCOUNT_ID}"
Environment="R2_PUBLIC_URL=https://photos.lovewithoutborders.email"
Environment="AWS_SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue"
Environment="NETLIFY_EMAIL_ENDPOINT=https://sharedmoments.socialboostai.com/.netlify/functions/direct-email"

[Install]
WantedBy=multi-user.target
EOF

# Set proper permissions
chown -R ec2-user:ec2-user /home/ec2-user/wedding-processor

# Enable and start the service
systemctl daemon-reload
systemctl enable wedding-streaming-processor
systemctl start wedding-streaming-processor

echo "Setup complete at $(date)"
echo "Service status:"
systemctl status wedding-streaming-processor --no-pager
