# Download Not Working - AWS Flow Diagnosis

## Your Setup
- **Collection Size**: 230MB (200MB video + 30MB video)
- **Expected Flow**: Netlify → AWS Lambda → SQS Queue → EC2 → Email
- **Lambda Function**: `wedding-photo-spot-launcher`
- **Lambda URL**: `https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/`
- **SQS Queue**: `https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue`

## Critical Finding

🚨 **The Netlify function is NOT calling your AWS Lambda!**

I searched the entire `netlify/functions/email-download.js` file and found:
- ✅ Routes to Cloudflare Worker
- ✅ Routes to Google Cloud Run (dead code)
- ❌ **NO route to AWS Lambda!**

This is why your emails aren't arriving - the request never reaches AWS.

## What Happened

Looking at the code:
1. User clicks "Download All"
2. Netlify function analyzes: 230MB > 50MB threshold
3. Tries to route to **Cloudflare Worker** (line 480 in email-download.js)
4. Cloudflare Worker probably doesn't exist or fails
5. Falls back to Netlify direct processing (which times out after 10 seconds)
6. No email sent

**Your AWS infrastructure is sitting idle, never receiving requests!**

## The Fix

You need to add AWS routing back to `netlify/functions/email-download.js`. Here's what needs to be added:

### Option 1: Add AWS Route to Netlify Function

Add this function to `netlify/functions/email-download.js`:

```javascript
// Route large videos to AWS Lambda
async function routeToAWSLambda(photos, eventId, email, requestId) {
  console.log(`🚀 Routing to AWS Lambda [${requestId}]`);
  
  const AWS_LAMBDA_URL = process.env.AWS_LAMBDA_URL || 'https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/';
  
  try {
    const response = await fetch(AWS_LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId,
        email,
        photos,
        requestId
      }),
      signal: AbortSignal.timeout(30000)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lambda responded with ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`✅ AWS Lambda accepted request [${requestId}]:`, result);
    
    return {
      success: true,
      message: result.message || 'Processing with AWS Lambda',
      requestId
    };
    
  } catch (error) {
    console.error(`❌ AWS Lambda routing failed [${requestId}]:`, error.message);
    throw error;
  }
}
```

Then modify the routing logic around line 475 to use AWS instead:

```javascript
// Step 2: Smart routing - Route large collections to AWS Lambda
if (isLargeCollection || hasVideos) {
  console.log(`🚀 Large collection detected [${requestId}] - Routing to AWS Lambda`);
  
  try {
    // Route to AWS Lambda
    const awsResult = await routeToAWSLambda(photos, eventId, email, requestId);
    
    console.log(`✅ AWS routing successful [${requestId}]:`, awsResult.message);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        processing: 'aws-lambda',
        message: hasVideos 
          ? `Processing ${photos.length} files (${fileSizeMB.toFixed(0)}MB) including ${videoCount} videos. You'll receive an email in 3-8 minutes.`
          : `Processing ${photos.length} files (${fileSizeMB.toFixed(0)}MB). You'll receive an email in 2-5 minutes.`,
        fileCount: photos.length,
        estimatedSizeMB: Math.round(fileSizeMB),
        videoCount,
        estimatedWaitTime: hasVideos ? '3-8 minutes' : '2-5 minutes',
        requestId,
        processingEngine: 'aws-ec2-spot'
      }),
    };
    
  } catch (awsError) {
    console.warn(`⚠️ AWS routing failed [${requestId}]:`, awsError.message);
    
    // Return error instead of fallback (so you know it's broken)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'AWS processing unavailable',
        details: awsError.message,
        requestId
      }),
    };
  }
}
```

### Option 2: Quick Environment Variable Fix

Add to Netlify environment variables:
```
AWS_LAMBDA_URL=https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/
```

## Testing After Fix

### 1. Test Lambda Directly
```bash
curl -X POST https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-123",
    "email": "your-email@example.com",
    "photos": []
  }'
```

Expected response:
```json
{
  "success": true,
  "message": "EC2 instance launched",
  "instanceId": "i-xxxxx"
}
```

### 2. Check SQS Queue
```bash
# On your local machine with AWS credentials
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names ApproximateNumberOfMessages
```

Should show messages > 0 if jobs are queuing.

### 3. Check EC2 Instances
```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
  --region us-east-1
```

Should show a running or pending instance.

## Why This Broke

Likely scenarios:
1. **Code refactor** removed AWS routing when adding Cloudflare Worker support
2. **Dead code** - Google Cloud Run was added, AWS code was removed
3. **Environment variable** missing that controlled routing

## Immediate Action Items

1. ✅ **Add AWS routing back** to Netlify function (code above)
2. ✅ **Set AWS_LAMBDA_URL** in Netlify environment variables
3. ✅ **Test Lambda directly** to verify it works
4. ✅ **Deploy and test** end-to-end

## Need Help Implementing?

I can:
1. Show you exactly where to add the code in `netlify/functions/email-download.js`
2. Create a complete updated version of the file
3. Help test the Lambda function directly

Let me know and I'll implement the fix!
