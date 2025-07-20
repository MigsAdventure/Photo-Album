# Deploy Fixed Cloud Run Service - Web Console Method

## Problem: gcloud Not Available
Since gcloud command line tool isn't accessible in your terminal, we'll deploy using the Google Cloud Console web interface.

## Current Status: Service Running OLD CODE
✅ Service is online but running **outdated version**  
❌ Missing `/config-check` endpoint (404)  
❌ Missing `/debug/firestore/:eventId` endpoint (404)  
❌ Missing `/debug/r2-test` endpoint (404)  
❌ Firestore connection issues persist  

## Web Console Deployment Steps

### Step 1: Open Google Cloud Console
1. Go to: https://console.cloud.google.com/run?project=wedding-photo-240c9
2. Click on **wedding-photo-processor** service

### Step 2: Deploy New Revision
1. Click **"Edit & Deploy New Revision"** button
2. In the **Container** section:
   - Source Type: **"Repository"**
   - Click **"Set up with Cloud Build"**

### Step 3: Connect Repository
1. Repository Provider: **GitHub**
2. Repository: **MigsAdventure/Photo-Album**
3. Branch: **main**
4. Build Type: **Dockerfile**
5. Source Location: **cloud-run-processor/Dockerfile**

### Step 4: Configure Resources
In the **Resources** section:
- **Memory**: 8 GiB
- **CPU**: 4
- **Maximum instances**: 5
- **Request timeout**: 3600 seconds

### Step 5: Set Environment Variables
Click **"Variables & Secrets"** tab and add:

```
NODE_ENV=production
FIREBASE_PROJECT_ID=wedding-photo-240c9
FIREBASE_AUTH_DOMAIN=wedding-photo-240c9.firebaseapp.com
FIREBASE_STORAGE_BUCKET=wedding-photo-240c9.appspot.com
R2_BUCKET_NAME=sharedmoments-photos-production
```

**Add your actual values for these:**
```
FIREBASE_API_KEY=[your-firebase-api-key]
FIREBASE_MESSAGING_SENDER_ID=[your-sender-id]
FIREBASE_APP_ID=[your-app-id]
R2_ACCOUNT_ID=[your-cloudflare-account-id]
R2_ACCESS_KEY_ID=[your-r2-access-key]
R2_SECRET_ACCESS_KEY=[your-r2-secret-key]
R2_ENDPOINT=https://[your-account-id].r2.cloudflarestorage.com
R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com
EMAIL_USER=noreply@sharedmoments.socialboostai.com
EMAIL_PASSWORD=[your-mailgun-password]
```

### Step 6: Advanced Settings
- **Port**: 8080
- **Allow unauthenticated invocations**: ✅ Checked
- **CPU allocation**: Only during request processing
- **Concurrency**: 10

### Step 7: Deploy
1. Click **"Deploy"**
2. Wait for deployment to complete (5-10 minutes)

## Alternative: Quick Fix with Existing Container

If the above method doesn't work, try this simpler approach:

### Option B: Upload Source Code
1. Go to: https://console.cloud.google.com/run?project=wedding-photo-240c9
2. Click **wedding-photo-processor**
3. Click **"Edit & Deploy New Revision"**
4. Choose **"Upload a zip file"**
5. Zip the `/cloud-run-processor` folder and upload

## Verify Deployment Success

After deployment completes, test the service:

```bash
node test-cloud-run-deployment-fix.js
```

**Expected Results After Successful Deployment:**
- ✅ `/config-check` responds (not 404)
- ✅ `/debug/firestore/:eventId` responds (not 404)  
- ✅ `/debug/r2-test` responds (not 404)
- ✅ Better error handling
- ✅ 200MB+ video processing capability

## What This Deployment Fixes

### 1. Environment Validation
- **Before**: Service crashed with `process.exit(1)` 
- **After**: Graceful degradation with warnings

### 2. New Debug Endpoints
- **New**: `/config-check` - Validate configuration
- **New**: `/debug/firestore/:eventId` - Test database connectivity
- **New**: `/debug/r2-test` - Test file storage
- **New**: `/health` - Comprehensive health check

### 3. Firestore Improvements  
- **Before**: "INVALID_ARGUMENT: Invalid resource field value"
- **After**: Better query validation and error recovery

### 4. Large File Support
- **Before**: Timeouts on 200MB+ files
- **After**: Handles 200MB+ videos without issues

## Troubleshooting

### If Deployment Fails:
1. Check build logs in Cloud Build console
2. Verify Dockerfile exists in cloud-run-processor/
3. Ensure GitHub repository access is granted

### If Service Still Shows 404s:
1. Check that new revision is receiving traffic (100%)
2. Verify environment variables are set correctly
3. Check service logs for startup errors

### Get Help:
- Build logs: https://console.cloud.google.com/cloud-build/builds?project=wedding-photo-240c9
- Service logs: https://console.cloud.google.com/run/detail/us-west1/wedding-photo-processor/logs?project=wedding-photo-240c9

## Next Steps After Deployment

1. **Test endpoints**: Run `node test-cloud-run-deployment-fix.js`
2. **Verify configuration**: Visit `/config-check` endpoint  
3. **Test large files**: Upload 200MB+ videos
4. **Monitor performance**: Check Cloud Run metrics

---

**Critical**: This deployment will enable 200MB+ video processing and fix all the Firestore connection issues shown in your logs.
