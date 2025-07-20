#!/bin/bash

# Google Cloud Function Deployment Script
# Deploys wedding photo processor with 500MB+ video support

echo "🚀 Deploying Google Cloud Function for 500MB+ video processing..."

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "Please install gcloud: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if logged in to gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Error: Not logged in to gcloud"
    echo "Please run: gcloud auth login"
    exit 1
fi

# Use existing Firebase project
PROJECT_ID="wedding-photo-240c9"
echo "🔧 Using your existing Firebase project: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "🔧 Enabling required Google Cloud APIs..."
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable storage-component.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# Create storage bucket for large files (if it doesn't exist)
BUCKET_NAME="sharedmoments-large-files-$(gcloud config get-value project)"
echo "📦 Creating storage bucket: $BUCKET_NAME"
gsutil mb gs://$BUCKET_NAME 2>/dev/null || echo "Bucket already exists"

# Set bucket to public read
echo "🌐 Setting bucket permissions..."
gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME

# Deploy the function with high memory and timeout (2nd gen Cloud Functions)
echo "☁️ Deploying modern 2nd generation Google Cloud Function..."
gcloud functions deploy processWeddingPhotos \
    --runtime nodejs20 \
    --trigger-http \
    --allow-unauthenticated \
    --memory=8GB \
    --timeout=900s \
    --set-env-vars="GOOGLE_CLOUD_STORAGE_BUCKET=$BUCKET_NAME" \
    --source=. \
    --entry-point=processWeddingPhotos \
    --gen2

if [ $? -eq 0 ]; then
    echo "✅ Google Cloud Function deployed successfully!"
    
    # Get the function URL
    FUNCTION_URL=$(gcloud functions describe processWeddingPhotos --format="value(httpsTrigger.url)")
    echo "🔗 Function URL: $FUNCTION_URL"
    
    echo ""
    echo "📋 Next Steps:"
    echo "1. Add this URL to your Cloudflare Worker environment variables:"
    echo "   GOOGLE_CLOUD_FUNCTION_URL=$FUNCTION_URL"
    echo ""
    echo "2. Deploy your updated Cloudflare Worker:"
    echo "   cd ../cloudflare-worker && npx wrangler deploy"
    echo ""
    echo "3. Test with a 200MB+ video to verify routing works"
    echo ""
    echo "💰 Cost estimates:"
    echo "   - Free tier: 400,000 GB-seconds/month"
    echo "   - 500MB video (5 min): ~$0.05-0.10 per request"
    echo "   - Well within your $29/event pricing model"
    
else
    echo "❌ Deployment failed!"
    exit 1
fi
