#!/bin/bash

# Set permissions on the key file
chmod 400 /Users/mig/code/wedding-photo-app/aws-ec2-spot/wedding-photo-spot-key.pem

# SSH into the EC2 instance and check the logs for the specific event ID
echo "Connecting to EC2 instance to check logs for event ID 2025-07-25_23r423_8xron6po..."
ssh -i /Users/mig/code/wedding-photo-app/aws-ec2-spot/wedding-photo-spot-key.pem -o StrictHostKeyChecking=no ec2-user@54.210.124.127 "sudo grep -i '2025-07-25_23r423_8xron6po' /var/log/messages"