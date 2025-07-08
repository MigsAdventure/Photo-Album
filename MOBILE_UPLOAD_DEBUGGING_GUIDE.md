# Mobile Upload Debugging Guide

## Overview

This guide helps you debug mobile upload failures using the enhanced logging and error handling we've implemented.

## Enhanced Features Added

### 1. **Comprehensive Request Tracking**
- Every upload request now has a unique Request ID for tracking
- Mobile device detection with specific iOS/Android identification
- Complete request/response logging with timing information

### 2. **Mobile-Optimized Upload Strategy**
- XMLHttpRequest for mobile devices (better compatibility than fetch)
- Automatic image compression for large mobile photos (>8MB)
- Reduced timeout (30s for mobile vs 45s previously)
- Enhanced progress tracking with better error recovery

### 3. **Backend Timeout Protection**
- 8-second function timeout with graceful error handling
- R2 operation timeout (6 seconds) to prevent hanging
- Enhanced error categorization (R2 vs Firestore vs parsing errors)

### 4. **Smart Retry Logic**
- Fewer retries on mobile (2 vs 3 for desktop)
- Longer delays between retries on mobile
- Longer delays between multiple file uploads on mobile

## How to Debug Upload Failures

### Step 1: Check Netlify Function Logs

1. Go to your Netlify dashboard
2. Navigate to Functions → upload
3. Look for logs with the pattern: `[REQUEST_ID]`

**What to look for:**

```
✅ UPLOAD COMPLETED [abc123def] in 2500ms
❌ UPLOAD FAILED [abc123def] after 8000ms
🔍 MOBILE REQUEST DETECTED [abc123def]
```

### Step 2: Identify Failure Patterns

#### **Pattern 1: Function Timeout (Most Common)**
```
❌ FUNCTION TIMEOUT [abc123def] - Upload exceeded 8 seconds
```
**Solution:** This indicates the backend processing is too slow
- Check R2 connectivity
- Verify environment variables are set
- Check if Firestore is responding

#### **Pattern 2: Form Parsing Failure**
```
❌ BUSBOY ERROR [abc123def]: Unexpected end of form
```
**Solution:** This indicates the file data is corrupted during transmission
- Mobile network issue
- File too large
- CORS/encoding problem

#### **Pattern 3: R2 Upload Failure**
```
❌ UPLOAD/SAVE ERROR [abc123def]: phase: r2
```
**Solution:** R2 service issue
- Check R2 credentials
- Verify R2_PUBLIC_URL is set correctly
- Check Cloudflare R2 service status

#### **Pattern 4: Firestore Save Failure**
```
❌ UPLOAD/SAVE ERROR [abc123def]: phase: firestore
```
**Solution:** Firebase connection issue
- Check Firebase credentials
- Verify Firestore rules allow writes
- Check Firebase quota/billing

### Step 3: Mobile-Specific Debugging

#### **Frontend Console Logs**
Open browser dev tools on mobile and look for:

```
📱 XHR upload completed with status: 200
📱✅ MOBILE UPLOAD SUCCESS! Request ID: abc123def
📱❌ MOBILE UPLOAD FAILED - Request ID: abc123def
📷 Image compressed: 15.2MB → 3.8MB
```

#### **Network Tab Analysis**
1. Open Chrome DevTools → Network tab
2. Filter by "upload"
3. Look for the upload request:
   - **Status 200**: Success
   - **Status 500**: Backend error
   - **Status 408**: Timeout
   - **Failed/Red**: Network error

### Step 4: Testing Different Scenarios

#### **Test 1: Single Small Photo**
1. Take a photo with mobile camera
2. Upload immediately
3. Check if it succeeds

#### **Test 2: Single Large Photo**
1. Take highest quality photo
2. Upload and observe compression logs
3. Check if compressed version uploads

#### **Test 3: Multiple Photos**
1. Select 3-5 photos from gallery
2. Observe sequential upload behavior
3. Check for any timeouts during delays

#### **Test 4: Network Conditions**
1. Test on WiFi vs cellular
2. Test with weak signal
3. Test with VPN if available

## Common Issues and Solutions

### Issue: "Upload reaches 90% then fails"
**Cause:** Backend processing timeout
**Solution:** 
- Check Request ID in logs to see exact failure
- Usually R2 or Firestore connection issue

### Issue: "Multiple uploads all fail"
**Cause:** Network/memory pressure on mobile
**Solution:**
- Uploads now have longer delays between them
- Try uploading one at a time
- Check if compression is working

### Issue: "New events fail more than old events"
**Cause:** Event ID validation or path creation
**Solution:**
- Check if eventId is being passed correctly
- Verify R2 path structure in logs

### Issue: "iOS/HEIC photos fail"
**Cause:** HEIC format processing
**Solution:**
- Compression converts to JPEG automatically
- Check browser HEIC support

## Environment Variables to Verify

Ensure these are set in Netlify:
```
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://your-domain.r2.dev
REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
```

## Performance Monitoring

### Key Metrics to Track:
1. **Function Duration**: Should be < 8 seconds
2. **Upload Success Rate**: Should be > 95% for small files
3. **Compression Effectiveness**: Large files should compress significantly
4. **Mobile vs Desktop**: Mobile should now have similar success rates

### Success Indicators:
```
✅ R2 CLIENT INITIALIZED [abc123def]
✅ FILE PROCESSING COMPLETE [abc123def] - Final size: 2847291
✅ R2 UPLOAD SUCCESSFUL [abc123def]: "8d2f..."
🔗 GENERATED PUBLIC URL [abc123def]: https://...
💾 SAVING TO FIRESTORE [abc123def]
🎉 UPLOAD COMPLETED [abc123def]: photo.jpg -> events/...
```

## Emergency Fallbacks

If mobile uploads still fail after these improvements:

1. **Reduce max file size** in PhotoUpload.tsx (line with 50MB limit)
2. **Increase compression** (reduce quality from 0.85 to 0.7)
3. **Reduce max dimensions** (1920x1080 to 1280x720)
4. **Force single file uploads** (disable multiple selection temporarily)

## Getting Help

When reporting issues, please include:
1. **Request ID** from logs
2. **Device type** (iOS/Android version)
3. **Network type** (WiFi/cellular)
4. **File size** and type
5. **Error message** from both frontend and backend logs

## Next Steps

Monitor your Netlify function logs for the next few mobile uploads to see:
1. Are Request IDs appearing in logs?
2. Are mobile uploads being detected correctly?
3. Is compression working for large files?
4. Are timeouts resolved?

The enhanced logging will give you detailed visibility into exactly where uploads are failing, making it much easier to diagnose and fix any remaining issues.
