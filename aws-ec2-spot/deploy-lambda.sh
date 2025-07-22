#!/bin/bash

echo "🚀 Deploying Lambda function for EC2 Spot instance launcher..."

# Create deployment package
rm -f lambda-deployment.zip
zip -r lambda-deployment.zip lambda-function.js user-data.sh

# Update Lambda function
aws lambda update-function-code \
    --function-name wedding-photo-spot-launcher \
    --zip-file fileb://lambda-deployment.zip \
    --region us-east-1

echo "✅ Lambda function deployed successfully!"
echo "📊 Function URL: https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/"
