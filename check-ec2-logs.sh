#!/bin/bash

# Check if the key file exists
if [ ! -f "/Users/mig/code/wedding-photo-app/aws-ec2-spot/wedding-photo-spot-key.pem" ]; then
  echo "Error: SSH key file not found"
  exit 1
fi

# Set permissions on the key file
chmod 400 /Users/mig/code/wedding-photo-app/aws-ec2-spot/wedding-photo-spot-key.pem

# SSH into the EC2 instance and check the logs
echo "Connecting to EC2 instance at 54.210.124.127..."
ssh -i /Users/mig/code/wedding-photo-app/aws-ec2-spot/wedding-photo-spot-key.pem -o StrictHostKeyChecking=no ec2-user@54.210.124.127 "sudo journalctl -u node-app -n 200 | grep -i '2025-07-25_23r423_8xron6po'"