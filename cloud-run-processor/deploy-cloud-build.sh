#!/bin/bash

# Cloud Build Deployment (No Docker Required!)
# This builds the Docker image directly in Google Cloud

set -e

echo "🚀 Deploying Cloud Run Photo Processor via Cloud Build"
echo "===================================================="
echo "✅ No Docker required - builds in the cloud!"

# Configuration
PROJECT_ID="wedding-photo-240c9"
SERVICE_NAME="wedding-photo-processor"
REGION="us-west1"

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated with gcloud. Run: gcloud auth login"
    exit 1
fi

# Set the project
echo "🔧 Setting up project..."
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo "📡 Enabling required APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

# Deploy directly from source (Cloud Build handles Docker)
echo "🚢 Deploying to Cloud Run (Cloud Build will handle Docker)..."
gcloud run deploy ${SERVICE_NAME} \
    --source . \
    --platform managed \
    --region ${REGION} \
    --allow-unauthenticated \
    --memory 8Gi \
    --cpu 4 \
    --timeout 3600 \
    --concurrency 10 \
    --max-instances 5 \
    --set-env-vars="NODE_ENV=production" \
    --quiet

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format="value(status.url)")

echo ""
echo "🎉 Deployment Complete!"
echo "======================="
echo "🌐 Service URL: ${SERVICE_URL}"
echo "📋 Health check: ${SERVICE_URL}/"
echo "📋 Process endpoint: ${SERVICE_URL}/process-photos"
echo ""
echo "🔧 Environment Variables Setup:"
echo "==============================="
echo "Go to Google Cloud Console → Cloud Run → ${SERVICE_NAME} → Edit & Deploy New Revision"
echo ""
echo "Add these environment variables:"
echo "• R2_ACCOUNT_ID=your_account_id"
echo "• R2_ACCESS_KEY_ID=your_access_key"
echo "• R2_SECRET_ACCESS_KEY=your_secret_key"
echo "• R2_BUCKET_NAME=sharedmoments-photos-production"
echo "• R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com"
echo "• R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com"
echo "• FIREBASE_API_KEY=your_api_key"
echo "• FIREBASE_AUTH_DOMAIN=your_domain"
echo "• FIREBASE_PROJECT_ID=your_project_id"
echo "• FIREBASE_STORAGE_BUCKET=your_bucket"
echo "• FIREBASE_MESSAGING_SENDER_ID=your_sender_id"
echo "• FIREBASE_APP_ID=your_app_id"
echo "• EMAIL_USER=noreply@sharedmoments.socialboostai.com"
echo "• EMAIL_PASSWORD=your_email_password"
echo ""
echo "🧪 Test the deployment:"
echo "curl ${SERVICE_URL}/"
echo ""
echo "📱 Update your frontend to call: ${SERVICE_URL}/process-photos"
echo ""
echo "🎉 This single service replaces ALL your complex infrastructure!"
