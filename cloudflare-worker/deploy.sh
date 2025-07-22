#!/bin/bash

echo "🚀 Deploying Cloudflare Worker with AWS Lambda URL"

# Check if wrangler is installed via npm
if [ ! -f "node_modules/.bin/wrangler" ]; then
    echo "❌ Wrangler not found. Installing..."
    npm install
fi

# Deploy the worker
echo "📦 Deploying worker..."
npx wrangler deploy

echo "✅ Deployment complete!"
echo "📝 Note: The AWS_LAMBDA_URL is now configured in wrangler.toml"
echo "   URL: https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/"
