# EC2 R2 Upload Issue - FIXED ✅

## Problem Summary
The EC2 instance was processing ZIP files successfully but failing to:
1. Upload to R2 storage
2. Send email notifications with download links

## Root Causes Identified
1. **Multiple conflicting processing scripts** with different R2 credentials
2. **Incorrect R2 credentials** in the deployed code (wrong account ID and keys)
3. **EC2 instance running outdated code** that uploaded to S3 instead of R2

## Fixes Applied

### 1. Created Clean Processing Script
- **File**: `aws-ec2-spot/wedding-photo-processor.js`
- Uses correct R2 credentials from `.env`:
  - Account ID: `98a9cce92e578cafdb9025fa24a6ee7e`
  - Bucket: `sharedmoments-photos-production`
  - Public URL: `https://sharedmomentsphotos.socialboostai.com`

### 2. Updated User Data Script
- **File**: `aws-ec2-spot/user-data.sh`
- Embeds the complete processing logic with correct R2 credentials
- Configures systemd service for auto-start
- Implements 10-minute auto-shutdown for cost efficiency

### 3. Updated Lambda Function
- **File**: `aws-ec2-spot/lambda-function.js`
- Now reads user data from external file instead of inline
- Maintains SQS queue-based job management

### 4. Cleanup
- Removed 21 duplicate/outdated files
- Terminated running EC2 instance with old code
- Deployed updated Lambda function

## Current Flow (Fixed)
1. User clicks "Send Email" → Netlify function
2. Netlify routes to Cloudflare Worker
3. Cloudflare Worker routes large files to AWS Lambda
4. Lambda adds job to SQS queue and launches EC2 instance
5. EC2 instance:
   - ✅ Downloads files from Firebase
   - ✅ Creates ZIP archive
   - ✅ **Uploads to R2 storage** (FIXED)
   - ✅ **Sends email via Netlify function** (FIXED)
6. EC2 auto-shuts down after 10 minutes of inactivity

## Test the Fix
```bash
cd aws-ec2-spot
node test-fixed-flow.js
```

## Monitor Processing
When an EC2 instance is running, you can check:
- Health: `http://[INSTANCE_IP]:8080/health`
- Service logs: SSH to instance and run `journalctl -u wedding-processor -f`

## Cost
- ~$0.01-0.02 per job (t3.medium spot instance)
- Auto-shutdown ensures minimal costs

## Next Steps
The system should now work correctly. When users request photo downloads:
1. Files will be uploaded to R2 storage
2. Email will be sent with the download link
3. Processing will complete successfully

## Deployment Commands
```bash
# Deploy Lambda updates
cd aws-ec2-spot
./deploy-lambda.sh

# Check running instances
aws ec2 describe-instances --filters "Name=tag:Name,Values=wedding-photo-processor" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].{ID:InstanceId,IP:PublicIpAddress}" --output table --region us-east-1
