# Download Email Fix - AWS Lambda Integration Complete ✅

## Problem Identified

Your download emails weren't being sent because **Netlify was NOT calling your AWS Lambda**. The function was trying to route to:
1. Cloudflare Worker (which doesn't exist or wasn't configured)
2. Google Cloud Run (which you deleted)

**Your entire AWS infrastructure (Lambda, SQS, EC2) was sitting idle!**

## Changes Made

### File Modified: `netlify/functions/email-download.js`

#### 1. Added AWS Lambda Routing Function
Added new function `routeToAWSLambda()` that calls your Lambda function:
- Lambda URL: `https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/`
- Sends eventId, email, photos, and requestId
- 30-second timeout
- Proper error handling

#### 2. Updated Routing Logic
Changed line ~475 to route large collections (> 50MB or videos) to AWS Lambda instead of Cloudflare Worker:

**Before:**
```javascript
// Tried to route to Cloudflare Worker
const workerResult = await routeToCloudflareWorker(photos, eventId, email, requestId);
```

**After:**
```javascript
// Now routes to AWS Lambda
const awsResult = await routeToAWSLambda(photos, eventId, email, requestId);
```

#### 3. Better Error Handling
- If AWS Lambda fails, returns 500 error (so you know it's broken)
- Clear error messages in logs
- No silent fallbacks that hide problems

## How It Works Now

### For Your 230MB Collection (200MB + 30MB videos):

1. ✅ **User clicks "Download All"**
2. ✅ **Netlify analyzes**: 230MB > 50MB threshold + has videos
3. ✅ **Routes to AWS Lambda** (NEW!)
4. ✅ **Lambda queues job** to SQS
5. ✅ **Lambda launches EC2** Spot instance
6. ✅ **EC2 processes videos**, creates ZIP
7. ✅ **EC2 sends email** with download link
8. ✅ **EC2 auto-terminates**

## Testing the Fix

### 1. Quick Syntax Check ✅
Already done - file has valid syntax!

### 2. Deploy to Netlify
```bash
git add netlify/functions/email-download.js
git commit -m "Fix: Route large downloads to AWS Lambda instead of Cloudflare Worker"
git push
```

Netlify will automatically redeploy.

### 3. Test Lambda Directly (Optional)
```bash
curl -X POST https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-event-123",
    "email": "your-email@example.com",
    "photos": [{
      "id": "test1",
      "fileName": "test.jpg",
      "url": "https://example.com/test.jpg",
      "size": 1024
    }],
    "requestId": "manual-test-001"
  }'
```

Expected response:
```json
{
  "success": true,
  "message": "Job queued and EC2 instance launching",
  "instanceId": "i-xxxxx",
  "queuedJob": true
}
```

### 4. Test End-to-End
1. Upload 2 videos to an event
2. Click "Download All"
3. Check browser console - should see: `🚀 Routing to AWS Lambda`
4. Wait 3-8 minutes
5. Check your email!

## Monitoring

### Check Netlify Logs
1. Netlify Dashboard → Functions → `email-download`
2. Look for recent invocations
3. Should see:
   ```
   🚀 Large collection detected [requestId] - Routing to AWS Lambda (EC2 Spot processing)
   ✅ AWS Lambda routing successful [requestId]
   ```

### Check AWS Lambda Logs (from your local machine)
```bash
aws logs tail /aws/lambda/wedding-photo-spot-launcher --follow --region us-east-1
```

### Check SQS Queue
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-1
```

### Check EC2 Instances
```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
  "Name=instance-state-name,Values=running,pending" \
  --region us-east-1
```

## Environment Variables

Optional - Add to Netlify for easier configuration:
```
AWS_LAMBDA_URL=https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/
```

(The code has this as a fallback default, so it's not strictly required)

## What's Next

After deploying:
1. ✅ Try downloading your 230MB collection again
2. ✅ Check Netlify logs to confirm AWS routing
3. ✅ Check your email in 3-8 minutes
4. ✅ If it works - you're done!
5. ❌ If it doesn't - check Lambda/SQS/EC2 logs for errors

## Rollback Plan

If something goes wrong:
```bash
git revert HEAD
git push
```

This will restore the previous version (which wasn't working anyway, but good to know!).

## Cost Estimate

With AWS EC2 Spot:
- Lambda trigger: ~$0.0001
- EC2 t3.medium: ~$0.01-0.02 per job (2-3 minutes)
- S3 storage: ~$0.001
- Total per download: **~$0.02**

Much cheaper than alternatives!

## Summary

✅ **Root cause**: Netlify wasn't calling AWS Lambda  
✅ **Fix applied**: Added AWS Lambda routing  
✅ **Syntax validated**: No errors  
✅ **Ready to deploy**: Just push to git!  

Your 230MB video downloads should work now! 🎉
