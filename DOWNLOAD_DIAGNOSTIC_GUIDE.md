# Download All - Email Not Received - Diagnostic Guide

## The Flow You Described

Based on your description, the flow should be:
1. **User clicks "Download All"** on frontend
2. **Netlify Function** (`/netlify/functions/email-download`) receives request
3. **R2 (Cloudflare)** - Photos are stored here
4. **AWS Lambda** - Triggers processing
5. **AWS SQS Queue** - Queues the job
6. **AWS EC2** - Processes the ZIP file
7. **Back to Netlify** - Sends email with download link

## How to Diagnose

Since I don't have access to your AWS credentials, here's what you need to check:

### 1. Check SQS Queue
```bash
# Run this on your local machine (with AWS credentials configured)
cd /workspace
export $(cat .env | grep -v '^#' | xargs)
node check-sqs-queue.js
```

**What to look for:**
- Are there messages stuck in the queue?
- Queue depth > 0?
- Any dead letter queue messages?

### 2. Check EC2 Instances
```bash
node check-ec2-instances.js
```

**What to look for:**
- Is an EC2 instance running?
- Instance state: running, stopped, or terminated?
- If no instance is running, the Lambda should have launched one

### 3. Check Lambda Function Logs
```bash
# Check the Lambda that launches EC2
LAMBDA_FUNCTION_NAME=wedding-photo-launcher node check-lambda-logs.js

# Or check directly in AWS Console:
```
1. Go to AWS Lambda Console
2. Find function: `wedding-photo-launcher` (or similar name)
3. Click "Monitor" → "View logs in CloudWatch"
4. Look at the last 30 minutes of logs

**What to look for:**
- Did Lambda receive the trigger?
- Any errors launching EC2?
- Permission errors?

### 4. Check EC2 CloudWatch Logs
```bash
# From your local machine
cd aws-ec2-spot
node check-cloudwatch-logs.js
```

**What to look for:**
- Did EC2 start processing?
- Any errors downloading from R2?
- ZIP creation errors?
- Email sending errors?

### 5. Check Netlify Function Logs

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Navigate to your site → Functions
3. Find `email-download` function
4. Check recent invocations

**What to look for:**
- Did the function execute successfully?
- What was the response?
- Any timeout errors (10 second limit)?
- Did it route to AWS or try to process directly?

## Common Issues & Solutions

### Issue 1: No EC2 Instance Running
**Symptom**: Queue has messages but no EC2 to process them

**Solution**:
```bash
# Manually launch an EC2 instance
cd aws-ec2-spot
./launch-new-instance.sh
```

### Issue 2: EC2 Instance Shut Down Too Early
**Symptom**: Instance terminated before finishing

**Check**: `aws-ec2-spot/wedding-photo-processor.js` auto-shutdown logic

**Solution**: Increase idle timeout or disable auto-shutdown temporarily

### Issue 3: SQS Messages Stuck
**Symptom**: Messages in queue but not being processed

**Solutions**:
1. Check visibility timeout isn't too short
2. Verify EC2 has permission to read from SQS
3. Check EC2 is polling the queue

### Issue 4: Email Not Sending
**Symptom**: ZIP created but email never arrives

**Check**:
- Netlify environment variables: `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_HOST`
- Check spam/junk folder
- Verify Mailgun/SendGrid credits

**Manual Test**:
```bash
node send-test-email.js your-email@example.com
```

### Issue 5: R2 Access Issues
**Symptom**: Can't download photos from R2

**Check**:
- R2 credentials in environment
- R2 bucket permissions
- CORS settings on R2 bucket

## Quick Diagnostic Script

I'll create a script that checks all components:

```bash
#!/bin/bash
echo "=== Download Pipeline Diagnostic ==="
echo ""
echo "1. Checking SQS Queue..."
node check-sqs-queue.js

echo ""
echo "2. Checking EC2 Instances..."
node check-ec2-instances.js

echo ""
echo "3. Checking Lambda Logs..."
LAMBDA_FUNCTION_NAME=wedding-photo-launcher node check-lambda-logs.js | head -50

echo ""
echo "4. Checking EC2 CloudWatch Logs..."
cd aws-ec2-spot && node check-cloudwatch-logs.js | head -50
```

## What Specific Event Should I Check?

To help you better, I need to know:
1. **Event ID** - Which event did you try to download?
2. **Time** - When did you click "Download All"? (exact time helps with logs)
3. **Email** - Which email address did you enter?
4. **Did you get any confirmation message** on the frontend?

With this info, I can create a targeted diagnostic script to trace that specific request through the entire pipeline.

## Next Steps

1. **Check Netlify logs** first - easiest to access
2. **Check SQS queue** - see if message arrived
3. **Check Lambda logs** - see if EC2 was launched
4. **Check EC2 logs** - see if processing happened

Let me know what you find at each step, and I'll help diagnose further!
