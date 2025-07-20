#!/bin/bash

# Simple Cloud Run Deployment Script
# This replaces all the complex serverless functions with one reliable service

set -e

echo "🚀 Deploying Simple Cloud Run Photo Processor"
echo "==============================================="

# Configuration
PROJECT_ID="wedding-photo-240c9"
SERVICE_NAME="wedding-photo-processor"
REGION="us-west1"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated with gcloud. Run: gcloud auth login"
    exit 1
fi

echo "📦 Building Docker image..."
docker build -t ${IMAGE_NAME} .

echo "☁️ Pushing to Google Container Registry..."
docker push ${IMAGE_NAME}

echo "🚢 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --platform managed \
    --region ${REGION} \
    --project ${PROJECT_ID} \
    --allow-unauthenticated \
    --memory 8Gi \
    --cpu 4 \
    --timeout 3600 \
    --concurrency 10 \
    --max-instances 5 \
    --set-env-vars="NODE_ENV=production" \
    --quiet

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --project=${PROJECT_ID} --format="value(status.url)")

echo ""
echo "✅ Deployment Complete!"
echo "========================"
echo "🌐 Service URL: ${SERVICE_URL}"
echo "📋 Test endpoint: ${SERVICE_URL}/process-photos"
echo ""
echo "🔧 Don't forget to set these environment variables in Cloud Run Console:"
echo "  - R2_ACCOUNT_ID"
echo "  - R2_ACCESS_KEY_ID" 
echo "  - R2_SECRET_ACCESS_KEY"
echo "  - R2_BUCKET_NAME"
echo "  - R2_ENDPOINT"
echo "  - R2_PUBLIC_URL"
echo "  - FIREBASE_API_KEY"
echo "  - FIREBASE_AUTH_DOMAIN"
echo "  - FIREBASE_PROJECT_ID"
echo "  - FIREBASE_STORAGE_BUCKET"
echo "  - FIREBASE_MESSAGING_SENDER_ID"
echo "  - FIREBASE_APP_ID"
echo "  - EMAIL_USER"
echo "  - EMAIL_PASSWORD"
echo ""
echo "📱 Update your frontend to call: ${SERVICE_URL}/process-photos"
echo "   Instead of the complex Netlify/Cloudflare routing"
echo ""
echo "🎉 This single service replaces all the complex multi-platform setup!"
