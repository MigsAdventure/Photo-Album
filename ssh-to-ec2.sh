#!/bin/bash

# SSH to EC2 instance and check logs
ssh -i /Users/mig/code/wedding-photo-app/aws-ec2-spot/wedding-photo-spot-key.pem ec2-user@54.210.124.127 "sudo cat /var/log/user-data.log | tail -n 100"