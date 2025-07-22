#!/bin/bash

echo "🚀 Deploying Lambda with Streaming Processor Support"

# Check if streaming user data exists
if [ ! -f "user-data-streaming.sh" ]; then
    echo "❌ Error: user-data-streaming.sh not found"
    exit 1
fi

# Clean up old deployment package
rm -f lambda-deployment.zip

# Create deployment package with both user data scripts
echo "📦 Creating deployment package..."
zip -r lambda-deployment.zip \
    lambda-function.js \
    package.json \
    package-lock.json \
    node_modules/ \
    user-data.sh \
    user-data-streaming.sh

echo "📊 Package contents:"
unzip -l lambda-deployment.zip | grep -E "(\.js|\.sh|\.json)$"

# Update Lambda function code
echo "⬆️ Updating Lambda function code..."
aws lambda update-function-code \
    --function-name wedding-photo-spot-launcher \
    --zip-file fileb://lambda-deployment.zip \
    --no-cli-pager

# Wait for update to complete
echo "⏳ Waiting for Lambda update..."
sleep 5

# Verify the USER_DATA_SCRIPT environment variable is set
echo "🔧 Verifying Lambda configuration..."
aws lambda get-function-configuration \
    --function-name wedding-photo-spot-launcher \
    --query 'Environment.Variables.USER_DATA_SCRIPT' \
    --output text

echo "✅ Lambda deployment complete!"
echo "📝 The Lambda will now use:"
echo "   - user-data-streaming.sh when USER_DATA_SCRIPT=STREAMING"
echo "   - user-data.sh otherwise"
