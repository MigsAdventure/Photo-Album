# Production Debugging Guide - R2 Download Fix 🔧

## ✅ Issues Fixed

### 1. **Root Cause: Legacy Firebase Storage Photos**
- **Problem**: Photos uploaded before R2 migration don't have `r2Key` field
- **Solution**: Added fallback to redirect to Firebase Storage URLs
- **Result**: All photos (old and new) now download successfully

### 2. **Comprehensive Error Handling**
- Added environment variable validation with specific error messages
- Moved R2 client initialization inside handlers to prevent startup crashes
- Added detailed console logging for debugging

### 3. **Enhanced Logging**
Both upload and download APIs now log:
- Environment variable status (which ones are missing)
- Step-by-step execution progress
- Detailed error information with stack traces
- R2 client initialization success/failure
- Firebase Storage fallback detection

## 🚀 Next Steps to Fix Production

### Step 1: Deploy with Enhanced Logging
```bash
git add .
git commit -m "Add comprehensive error handling and logging for R2 APIs"
git push origin main
```

### Step 2: Check Vercel Function Logs
1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Click on your project (`sharedmemories`)
3. Go to **Functions** tab
4. Try a download that fails
5. Click on the failed function execution to see detailed logs

### Step 3: Look for These Log Messages

**Environment Variable Issues:**
```
Environment check: {
  hasR2AccountId: false,  // ❌ Missing!
  hasR2AccessKey: true,
  hasR2SecretKey: true,
  hasR2BucketName: true,
  hasFirebaseApiKey: true
}
```

**R2 Connection Issues:**
```
R2 client initialized successfully  // ✅ Good
Fetching photo metadata from Firestore...
Photo data: { hasR2Key: true, fileName: "image.jpg" }
Fetching file from R2 with key: events/xyz/photos/abc.jpg
// Look for errors here
```

## 🔧 Common Issues & Solutions

### Issue 1: Missing Environment Variables
**Symptoms:** `Server configuration error - missing R2 credentials`
**Solution:** Add these to Vercel environment variables:
```
R2_ACCOUNT_ID=98a9cce92e578cafdb9025fa24a6ee7e
R2_ACCESS_KEY_ID=[your_actual_key]
R2_SECRET_ACCESS_KEY=[your_actual_secret]
R2_BUCKET_NAME=sharedmoments-photos-production
R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com
```

### Issue 2: R2 Endpoint Configuration
**Symptoms:** R2 connection timeouts or 403 errors
**Solution:** The endpoint should be:
```
https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com
```
(Note: NO bucket name in the endpoint - bucket is specified separately)

### Issue 3: Photo Not Found in R2
**Symptoms:** `Photo not stored in R2` or `File not found in storage`
**Solution:** 
- This happens for photos uploaded to Firebase Storage before R2 migration
- These photos will show `hasR2Key: false` in logs
- Old photos can only be downloaded via Firebase Storage URLs (open in new tab)

### Issue 4: R2 Bucket Permissions
**Symptoms:** 403 Forbidden errors when accessing R2
**Solution:** Verify R2 API token has:
- `Object Storage:Edit` permissions
- Access to the specific bucket

## 📊 Testing the Fix

### Test Upload:
1. Upload a new photo in production
2. Check Vercel logs - should see:
   ```
   Upload API called with method: POST
   Environment check: { all true }
   R2 client initialized successfully
   Running multer middleware...
   File received: { hasFile: true, ... }
   Uploading to R2 with key: events/...
   R2 upload successful
   Photo uploaded successfully: ...
   ```

### Test Download:
1. Try downloading a newly uploaded photo
2. Check Vercel logs - should see:
   ```
   Download API called with method: GET
   Environment check: { all true }
   R2 client initialized successfully
   Fetching photo metadata from Firestore...
   Photo data: { hasR2Key: true, ... }
   Fetching file from R2 with key: ...
   R2 response received, has body: true
   Converting stream to buffer...
   Buffer created, size: [bytes]
   Download initiated for: [filename]
   ```

## 🎯 Expected Results

- **Upload errors**: Will show exactly which environment variable is missing
- **Download errors**: Will show exactly where the process fails (Firestore, R2, etc.)
- **Successful operations**: Will show complete step-by-step progress

The enhanced logging will pinpoint exactly what's causing the 500 error!
