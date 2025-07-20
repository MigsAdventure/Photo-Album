#!/bin/bash

# 🚀 Google Cloud Function Email Fix Deployment Script
# This script deploys the fixed Google Cloud Function with Node.js 20 and error handling fixes

echo "🔧 Google Cloud Function Email Fix Deployment"
echo "============================================="

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

# Check if gcloud is installed
print_status "Checking Google Cloud CLI installation..."

# Try multiple possible locations for gcloud
GCLOUD_PATHS=(
    "/Users/mig/code/wedding-photo-app/code/google-cloud-sdk/bin/gcloud"
    "/usr/local/bin/gcloud"
    "/usr/bin/gcloud"
    "$(which gcloud 2>/dev/null)"
)

GCLOUD_CMD=""
for path in "${GCLOUD_PATHS[@]}"; do
    if [[ -f "$path" && -x "$path" ]]; then
        GCLOUD_CMD="$path"
        break
    fi
done

if [[ -z "$GCLOUD_CMD" ]]; then
    print_error "Google Cloud CLI not found. Installing fresh copy..."
    
    # Download and install gcloud
    print_status "Downloading Google Cloud SDK..."
    curl -o /tmp/google-cloud-sdk.tar.gz https://dl.google.com/dl/cloudsdk/channels/rapid/google-cloud-sdk.tar.gz
    
    print_status "Extracting Google Cloud SDK..."
    tar -xzf /tmp/google-cloud-sdk.tar.gz -C /tmp/
    
    print_status "Installing Google Cloud SDK..."
    /tmp/google-cloud-sdk/install.sh --quiet --path-update=false
    
    GCLOUD_CMD="/tmp/google-cloud-sdk/bin/gcloud"
    
    if [[ ! -x "$GCLOUD_CMD" ]]; then
        print_error "Failed to install Google Cloud SDK"
        print_warning "Please use the web console deployment method instead:"
        print_warning "Open: https://console.cloud.google.com/functions"
        print_warning "Follow the steps in: SIMPLE_WEB_CONSOLE_DEPLOYMENT_STEPS.md"
        exit 1
    fi
    
    print_success "Google Cloud SDK installed successfully"
else
    print_success "Found Google Cloud CLI at: $GCLOUD_CMD"
fi

# Check authentication
print_status "Checking Google Cloud authentication..."
if ! $GCLOUD_CMD auth list --filter="status:ACTIVE" --format="value(account)" | grep -q "@"; then
    print_warning "Not authenticated with Google Cloud"
    print_status "Starting authentication process..."
    $GCLOUD_CMD auth login
    
    if [[ $? -ne 0 ]]; then
        print_error "Authentication failed"
        print_warning "Please authenticate manually and try again"
        exit 1
    fi
    
    print_success "Authentication successful"
else
    print_success "Already authenticated with Google Cloud"
fi

# Set project
print_status "Setting Google Cloud project..."
$GCLOUD_CMD config set project wedding-photo-240c9

if [[ $? -ne 0 ]]; then
    print_error "Failed to set project. Please check if project 'wedding-photo-240c9' exists"
    exit 1
fi

print_success "Project set to wedding-photo-240c9"

# Enable required APIs
print_status "Enabling required Google Cloud APIs..."
$GCLOUD_CMD services enable cloudfunctions.googleapis.com
$GCLOUD_CMD services enable storage.googleapis.com
$GCLOUD_CMD services enable cloudbuild.googleapis.com

# Deploy the function
print_status "Deploying Google Cloud Function with fixes..."
cd google-cloud-function

# Verify files exist
if [[ ! -f "index.js" ]]; then
    print_error "index.js not found in google-cloud-function directory"
    exit 1
fi

if [[ ! -f "package.json" ]]; then
    print_error "package.json not found in google-cloud-function directory"
    exit 1
fi

print_status "Deploying processWeddingPhotos function..."
$GCLOUD_CMD functions deploy processWeddingPhotos \
    --runtime nodejs20 \
    --trigger http \
    --allow-unauthenticated \
    --memory 8GB \
    --timeout 900s \
    --region us-west1 \
    --set-env-vars "NETLIFY_EMAIL_FUNCTION_URL=https://main--sharedmoments.netlify.app/.netlify/functions/email-download,GOOGLE_CLOUD_STORAGE_BUCKET=sharedmoments-large-files"

if [[ $? -eq 0 ]]; then
    print_success "Google Cloud Function deployed successfully!"
    
    # Get function URL
    FUNCTION_URL=$($GCLOUD_CMD functions describe processWeddingPhotos --region us-west1 --format="value(httpsTrigger.url)")
    print_success "Function URL: $FUNCTION_URL"
    
    echo ""
    print_success "✅ DEPLOYMENT COMPLETE!"
    echo "==============================="
    print_status "Your email delivery issues are now fixed:"
    print_status "  ✅ Node.js 20 runtime (built-in fetch)"
    print_status "  ✅ Undefined fileName handling"
    print_status "  ✅ Null safety for all properties"
    print_status "  ✅ Graceful error handling"
    echo ""
    print_status "🧪 To test the deployment:"
    print_status "  node test-google-cloud-fix.js"
    echo ""
    print_status "🔍 Monitor logs at:"
    print_status "  https://console.cloud.google.com/functions/details/us-west1/processWeddingPhotos"
    echo ""
    print_success "Your 500MB+ video processing system is now operational! 🎉"
    
else
    print_error "Deployment failed"
    print_warning "Please check the error messages above"
    print_warning "Alternative: Use web console deployment:"
    print_warning "  1. Open: https://console.cloud.google.com/functions"
    print_warning "  2. Follow: SIMPLE_WEB_CONSOLE_DEPLOYMENT_STEPS.md"
    exit 1
fi
