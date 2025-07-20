# Deploy Fixed Cloud Run Service - Manual Instructions

## Problem Confirmed
Your Cloud Run service is running **OLD CODE** without the critical fixes:
- ❌ Missing `/config-check` endpoint (404 error)
- ❌ Missing `/debug/firestore/:eventId` endpoint (404 error) 
- ❌ Missing `/debug/r2-test` endpoint (404 error)
- ❌ Still has Firestore connection issues
- ❌ Still has environment validation problems

## Solution: Deploy Updated Code

### Step 1: Open Terminal with gcloud Access
Since gcloud isn't available in the current terminal session, you need to:

1. Open a **new terminal** where gcloud is in your PATH
2. Or add gcloud to PATH in current terminal:
```bash
# Find your gcloud installation
which gcloud

# If not found, try common locations:
export PATH="/usr/local/google-cloud-sdk/bin:$PATH"
# OR
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
# OR  
export PATH="/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin:$PATH"

# Verify it works
gcloud version
```

### Step 2: Navigate to Project Directory
```bash
cd /Users/mig/code/wedding-photo-app/cloud-run-processor
```

### Step 3: Run the Deployment Script
```bash
bash deploy-cloud-build.sh
```

**OR** run the deployment command directly:
```bash
gcloud run deploy wedding-photo-processor \
    --source . \
    --platform managed \
    --region us-west1 \
    --allow-unauthenticated \
    --project wedding-photo-240c9 \
    --memory 8Gi \
    --cpu 4 \
    --timeout 3600 \
    --concurrency 10 \
    --max-instances 5 \
    --set-env-vars="NODE_ENV=production"
```

### Step 4: Verify Deployment Success
After deployment completes, run the test:
```bash
cd /Users/mig/code/wedding-photo-app
node test-cloud-run-deployment-fix.js
```

**Expected Results After Successful Deployment:**
- ✅ `/config-check` responds (not 404)
- ✅ `/debug/firestore/:eventId` responds (not 404)
- ✅ `/debug/r2-test` responds (not 404)
- ✅ Better error handling for missing environment variables
- ✅ Firestore connection improvements

## Critical Fixes That Will Be Applied

### 1. **Environment Validation Fixed**
- **Before**: Service crashed with `process.exit(1)` if env vars missing
- **After**: Service starts with warnings, graceful degradation

### 2. **Debug Endpoints Added**
- **New**: `/config-check` - Validate environment setup
- **New**: `/debug/firestore/:eventId` - Test Firestore connectivity
- **New**: `/debug/r2-test` - Test R2/Cloudflare storage
- **New**: `/health` - Comprehensive health monitoring

### 3. **Better Error Handling** 
- **Before**: Hard crashes on configuration issues
- **After**: Graceful error handling with detailed logging

### 4. **Firestore Query Improvements**
- **Before**: Invalid argument errors causing failures
- **After**: Better query validation and error recovery

## After Deployment: Set Environment Variables

Once the new code is deployed, set these environment variables in the Google Cloud Console:

**Go to**: Cloud Run → wedding-photo-processor → Edit & Deploy New Revision → Variables & Secrets

**Required Variables:**
```
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=wedding-photo-240c9.firebaseapp.com
FIREBASE_PROJECT_ID=wedding-photo-240c9
FIREBASE_STORAGE_BUCKET=wedding-photo-240c9.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id

R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=sharedmoments-photos-production
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com

EMAIL_USER=noreply@sharedmoments.socialboostai.com
EMAIL_PASSWORD=your_mailgun_password
```

## Testing After Environment Variables Set

Run the test again to verify everything works:
```bash
node test-cloud-run-deployment-fix.js
```

**Expected Results:**
- ✅ All endpoints respond (200 status)
- ✅ Configuration check passes
- ✅ Firestore connectivity confirmed
- ✅ R2 storage connectivity confirmed
- ✅ 200MB+ video processing capability

## Benefits After This Fix

✅ **Large Video Support** - Handle 200MB+ files without timeout
✅ **Reliable Processing** - No more container startup failures  
✅ **Better Debugging** - Debug endpoints for troubleshooting
✅ **Firestore Fixed** - Resolve connection and query issues
✅ **Production Ready** - Proper error handling and monitoring

---

**Priority**: CRITICAL - Service currently running old, broken code
**Impact**: Enables 200MB+ video processing, fixes all startup issues
**Next Step**: Deploy using gcloud in a terminal where it's available
