#!/bin/bash
# Deploy fixed processor that doesn't exit

# Update Lambda to use fixed processor that stays alive
cd aws-ec2-spot

# Update the user-data in lambda-function.js to remove auto-termination
# and change Restart=always

# Package and deploy
zip -r lambda-fix-no-exit.zip lambda-function.js package.json node_modules/ 2>/dev/null || npm install && zip -r lambda-fix-no-exit.zip lambda-function.js package.json node_modules/

aws lambda update-function-code \
  --function-name wedding-photo-spot-launcher \
  --zip-file fileb://lambda-fix-no-exit.zip \
  --region us-east-1

echo "Lambda updated successfully"
