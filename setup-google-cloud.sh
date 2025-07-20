#!/bin/bash

# Quick Google Cloud Setup for Wedding Photo App
# Fixes the large video routing issue

echo "🚀 Setting up Google Cloud for 500MB+ video support..."

# Add gcloud to PATH
export PATH="/Users/mig/code/wedding-photo-app/code/google-cloud-sdk/bin:$PATH"

# Check if gcloud is available
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud not found in PATH"
    echo "Run this first:"
    echo "export PATH=\"/Users/mig/code/wedding-photo-app/code/google-cloud-sdk/bin:\$PATH\""
    exit 1
fi

echo "✅ gcloud found: $(gcloud --version | head -n1)"

# Check authentication
echo "🔐 Checking authentication..."
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -n1)

if [ -z "$ACTIVE_ACCOUNT" ]; then
    echo "🔑 Not authenticated. Starting login process..."
    echo "This will open a browser window for Google Cloud authentication."
    read -p "Press Enter to continue..."
    
    gcloud auth login
    
    if [ $? -ne 0 ]; then
        echo "❌ Authentication failed"
        exit 1
    fi
    
    echo "✅ Authentication successful!"
else
    echo "✅ Already authenticated as: $ACTIVE_ACCOUNT"
fi

# Check/set project
echo "📋 Checking project configuration..."
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)

if [ -z "$CURRENT_PROJECT" ] || [ "$CURRENT_PROJECT" = "(unset)" ]; then
    echo "📝 No project set. Available projects:"
    gcloud projects list --format="table(projectId,name,projectNumber)"
    
    echo ""
    read -p "Enter your project ID (or press Enter to create new): " PROJECT_ID
    
    if [ -z "$PROJECT_ID" ]; then
        # Create new project
        TIMESTAMP=$(date +%s)
        PROJECT_ID="wedding-photo-app-$TIMESTAMP"
        echo "🆕 Creating new project: $PROJECT_ID"
        
        gcloud projects create $PROJECT_ID --name="Wedding Photo App"
        
        if [ $? -ne 0 ]; then
            echo "❌ Project creation failed"
            exit 1
        fi
    fi
    
    echo "🔧 Setting project to: $PROJECT_ID"
    gcloud config set project $PROJECT_ID
    
else
    echo "✅ Using project: $CURRENT_PROJECT"
    PROJECT_ID=$CURRENT_PROJECT
fi

# Enable required APIs
echo "🔧 Enabling required APIs..."
gcloud services enable cloudfunctions.googleapis.com --quiet
gcloud services enable storage-component.googleapis.com --quiet
gcloud services enable cloudbuild.googleapis.com --quiet

if [ $? -eq 0 ]; then
    echo "✅ APIs enabled successfully"
else
    echo "⚠️ Some APIs may already be enabled"
fi

echo ""
echo "🎉 Google Cloud setup complete!"
echo "📋 Configuration:"
echo "   Account: $(gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1)"
echo "   Project: $(gcloud config get-value project)"
echo ""
echo "🚀 Next step: Deploy the function"
echo "   cd google-cloud-function && ./deploy.sh"
