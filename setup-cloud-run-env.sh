#!/bin/bash

# 🚀 Google Cloud Run Environment Variables Setup
# ================================================
# This script configures your wedding photo processor with all required environment variables

set -e

echo "🔧 Setting up Google Cloud Run Environment Variables"
echo "=================================================="

# Service configuration
PROJECT_ID="wedding-photo-240c9"
SERVICE_NAME="wedding-photo-processor"
REGION="us-west1"

echo "📋 Service: $SERVICE_NAME"
echo "📋 Project: $PROJECT_ID" 
echo "📋 Region: $REGION"
echo ""

# Check if gcloud is authenticated
echo "🔐 Checking Google Cloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated with Google Cloud"
    echo "Please run: gcloud auth login"
    exit 1
fi

echo "✅ Google Cloud authenticated"
echo ""

# Set project
echo "🎯 Setting project context..."
gcloud config set project $PROJECT_ID

# R2 Configuration (from your wrangler.toml)
echo "🪣 Setting R2 Storage Environment Variables..."
gcloud run services update $SERVICE_NAME \
    --region=$REGION \
    --set-env-vars="R2_BUCKET_NAME=sharedmoments-photos-production" \
    --set-env-vars="R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com" \
    --quiet

echo "✅ R2 configuration set"

# Email Configuration  
echo "📧 Setting Email Environment Variables..."
gcloud run services update $SERVICE_NAME \
    --region=$REGION \
    --set-env-vars="EMAIL_USER=noreply@sharedmoments.socialboostai.com" \
    --set-env-vars="EMAIL_HOST=smtp.mailgun.org" \
    --set-env-vars="EMAIL_PORT=587" \
    --quiet

echo "✅ Email configuration set"

# Application Configuration
echo "⚙️ Setting Application Environment Variables..."
gcloud run services update $SERVICE_NAME \
    --region=$REGION \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="ENVIRONMENT=production" \
    --set-env-vars="SERVICE_NAME=wedding-photo-processor" \
    --quiet

echo "✅ Application configuration set"

# Performance Configuration
echo "🚀 Setting Performance Configuration..."
gcloud run services update $SERVICE_NAME \
    --region=$REGION \
    --memory="4Gi" \
    --cpu="2" \
    --timeout="3600" \
    --concurrency="10" \
    --max-instances="100" \
    --quiet

echo "✅ Performance configuration set"

echo ""
echo "🎉 Environment Variables Configuration Complete!"
echo "==============================================="

echo ""
echo "📋 Next Steps - MANUAL CONFIGURATION REQUIRED:"
echo "=============================================="
echo ""
echo "You need to manually set these SENSITIVE environment variables:"
echo ""
echo "🔐 R2 Credentials:"
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"R2_ACCOUNT_ID=your_account_id\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"R2_ACCESS_KEY_ID=your_access_key\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"R2_SECRET_ACCESS_KEY=your_secret_key\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com\""
echo ""
echo "📧 Email Password:"
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"EMAIL_PASSWORD=your_smtp_password\""
echo ""
echo "🔥 Firebase Credentials:"
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"FIREBASE_API_KEY=your_api_key\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"FIREBASE_AUTH_DOMAIN=your_auth_domain\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"FIREBASE_PROJECT_ID=your_project_id\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"FIREBASE_STORAGE_BUCKET=your_storage_bucket\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"FIREBASE_MESSAGING_SENDER_ID=your_sender_id\""
echo "gcloud run services update $SERVICE_NAME --region=$REGION --set-env-vars=\"FIREBASE_APP_ID=your_app_id\""
echo ""
echo "💡 TIP: Get your credentials from:"
echo "   • R2: Cloudflare Dashboard → R2 → Manage R2 API tokens"
echo "   • Email: Your SMTP provider (Mailgun, SendGrid, etc.)"
echo "   • Firebase: Firebase Console → Project Settings → General"
echo ""
echo "🧪 After setting credentials, run: ./test-cloud-run-comprehensive.js"
echo ""

# Get current service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")
echo "🌐 Service URL: $SERVICE_URL"

# Test basic connectivity
echo ""
echo "🧪 Testing basic connectivity..."
if curl -s --max-time 10 "$SERVICE_URL/" > /dev/null; then
    echo "✅ Service is responding"
else
    echo "⚠️ Service not responding (may need credentials)"
fi

echo ""
echo "🎯 Ready for testing once credentials are set!"
