#!/bin/bash
set -e

# Get the instance ID from the command line or use the default
INSTANCE_ID=${1:-i-02f1eb8f436aac05c}
SCRIPT_PATH="$(pwd)/updated-process.js"

echo "🚀 Updating EC2 instance $INSTANCE_ID with new process.js"

# Check if the instance is running
STATUS=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].State.Name' --output text)
if [ "$STATUS" != "running" ]; then
  echo "❌ Instance $INSTANCE_ID is not running (status: $STATUS)"
  exit 1
fi

# Get the public IP of the instance
PUBLIC_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "📡 Instance public IP: $PUBLIC_IP"

# Copy the updated process.js to the instance
echo "📤 Copying updated process.js to the instance..."
aws ec2-instance-connect send-ssh-public-key \
  --instance-id $INSTANCE_ID \
  --availability-zone us-east-1a \
  --instance-os-user ec2-user \
  --ssh-public-key file://~/.ssh/id_rsa.pub

# Use SCP to copy the file
scp -o "StrictHostKeyChecking=no" $SCRIPT_PATH ec2-user@$PUBLIC_IP:/tmp/process.js

# SSH into the instance and update the application
echo "🔄 Updating the application on the instance..."
ssh -o "StrictHostKeyChecking=no" ec2-user@$PUBLIC_IP << 'EOF'
  # Install required dependencies
  sudo yum install -y npm
  cd /app
  sudo npm install archiver nodemailer @aws-sdk/client-s3 node-fetch
  
  # Backup the original process.js
  sudo cp process.js process.js.bak
  
  # Replace with the new version
  sudo cp /tmp/process.js process.js
  
  # Restart the application
  sudo pkill -f "node process.js" || echo "No process to kill"
  sudo node process.js > app.log 2>&1 &
  
  echo "✅ Application updated and restarted"
EOF

echo "✅ Update completed successfully"
echo "🔍 You can check the application status with: curl http://$PUBLIC_IP:8080/health"