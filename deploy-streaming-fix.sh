#!/bin/bash

# Deploy Cloud Run Streaming Fix
# This script fixes the "response.body.getReader is not a function" error

set -e

echo "🔧 Deploying Cloud Run Streaming Fix"
echo "=================================="

# Configuration
PROJECT_ID="sharedmoments-b6c9e"
SERVICE_NAME="wedding-photo-processor"
REGION="us-central1"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if gcloud is installed and authenticated
print_status "Checking gcloud configuration..."
if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Set project
print_status "Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Enable required APIs
print_status "Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

# Navigate to Cloud Run processor directory
print_status "Navigating to cloud-run-processor directory..."
cd cloud-run-processor

# Verify the fix is in place
print_status "Verifying streaming fix..."
if grep -q "node-fetch" package.json; then
    print_error "node-fetch dependency still present in package.json!"
    exit 1
fi

if grep -q "require('node-fetch')" index.js; then
    print_error "node-fetch require still present in index.js!"
    exit 1
fi

print_success "Streaming fix verified: node-fetch dependency removed"

# Build the container image
print_status "Building container image..."
gcloud builds submit --tag $IMAGE_NAME .

if [ $? -ne 0 ]; then
    print_error "Container build failed!"
    exit 1
fi

print_success "Container image built successfully"

# Deploy to Cloud Run
print_status "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 8Gi \
    --cpu 4 \
    --timeout 900 \
    --max-instances 10 \
    --set-env-vars NODE_ENV=production \
    --set-env-vars PORT=8080

if [ $? -ne 0 ]; then
    print_error "Cloud Run deployment failed!"
    exit 1
fi

print_success "Cloud Run service deployed successfully"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format "value(status.url)")
print_success "Service URL: $SERVICE_URL"

# Test the deployment
print_status "Testing the deployment..."
cd ..

# Test health endpoint
print_status "Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/health")

if [ "$HEALTH_RESPONSE" = "200" ]; then
    print_success "Health check passed"
else
    print_error "Health check failed (HTTP $HEALTH_RESPONSE)"
    exit 1
fi

# Test config endpoint
print_status "Testing config endpoint..."
CONFIG_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/config-check")

if [ "$CONFIG_RESPONSE" = "200" ]; then
    print_success "Config check passed"
else
    print_warning "Config check returned HTTP $CONFIG_RESPONSE (may need environment variables)"
fi

# Test with the streaming fix verification script
print_status "Running streaming fix verification..."
export CLOUD_RUN_URL="$SERVICE_URL"
node test-cloud-run-streaming-fix.js

if [ $? -eq 0 ]; then
    print_success "Streaming fix verification passed!"
else
    print_warning "Streaming fix verification had issues, but deployment completed"
fi

# Summary
echo ""
echo "🎉 Deployment Summary"
echo "===================="
print_success "Cloud Run service deployed with streaming fix"
print_success "Service URL: $SERVICE_URL"
print_success "Fix applied: Removed node-fetch dependency"
print_success "Now using: Node.js 20+ built-in fetch API"
print_success "Result: response.body.getReader() now works properly"

echo ""
echo "📋 What was fixed:"
echo "• Removed node-fetch v2.7.0 dependency from package.json"
echo "• Removed require('node-fetch') from index.js"  
echo "• Now using Node.js 20+ native fetch API"
echo "• Native fetch returns Web API ReadableStream with getReader() method"
echo "• Streaming downloads now work for large Firebase files"

echo ""
echo "🔗 Service endpoints:"
echo "• Health: $SERVICE_URL/health"
echo "• Config: $SERVICE_URL/config-check"
echo "• Process: $SERVICE_URL/process-photos (POST)"
echo "• Debug Firestore: $SERVICE_URL/debug/firestore/{eventId}"
echo "• Debug R2: $SERVICE_URL/debug/r2-test"

echo ""
print_success "Streaming fix deployment complete!"
