# SQS Email Delivery Solution - Final Working Configuration

**Last Updated:** October 12, 2025  
**Status:** ✅ WORKING - Tested with 230MB files  
**Next Tests:** 1.5GB video files, 50 media files

---

## Overview

This document describes the **complete working solution** for processing large wedding photo/video files via AWS EC2 Spot instances and delivering download links via email.

## Architecture Flow

```
User Upload → Netlify → R2 Storage → Lambda → SQS Queue → EC2 Instance → Email Delivery
```

1. **User uploads photos** → Netlify function
2. **Files copied to R2** → Cloudflare R2 storage
3. **Lambda triggered** → AWS Lambda (wedding-photo-spot-launcher)
4. **Job queued** → AWS SQS
5. **EC2 launched** → Spot instance processes from SQS
6. **ZIP created** → Streaming archiver uploads to R2
7. **Email sent** → Netlify email function → User receives download link

---

## Critical Components

### 1. Lambda Function (`lambda-function.js`)

**Location:** `aws-ec2-spot/lambda-function.js`

**Critical Configuration:**
- ✅ AMI: `ami-052064a798f08f0d3` (Amazon Linux 2023)
- ✅ IAM Instance Profile: `wedding-photo-processor-profile`
- ✅ User-data: Embedded directly in Lambda (downloads processor from GitHub)

**Key Points:**
- User-data is embedded in the Lambda function code
- Downloads the fixed processor from GitHub on instance boot
- Must use AL2023 AMI (supports Node.js 20)

### 2. EC2 Processor (`wedding-photo-processor-streaming-fixed.js`)

**Location:** `aws-ec2-spot/wedding-photo-processor-streaming-fixed.js`  
**GitHub:** Instances download from `https://raw.githubusercontent.com/MigsAdventure/Photo-Album/main/aws-ec2-spot/wedding-photo-processor-streaming-fixed.js`

**Critical Fixes:**
1. **Web Stream Conversion** (Line ~326):
   ```javascript
   const nodeStream = Readable.fromWeb(response.body);
   archive.append(nodeStream, { name: photo.fileName, date: new Date() });
   ```

2. **Email Parameters** (Line ~364):
   ```javascript
   body: JSON.stringify({
     email: email,           // NOT "to"!
     downloadUrl: downloadUrl,
     fileCount: fileCount,
     finalSizeMB: finalSizeMB
   })
   ```

### 3. IAM Instance Profile

**Name:** `wedding-photo-processor-profile`  
**Policy Document:** `aws-ec2-spot/instance-policy.json`

**Required Permissions:**
- SQS: `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`
- CloudWatch Logs: Write permissions
- EC2: `TerminateInstances` (for auto-shutdown)

### 4. Netlify Email Function

**Location:** `netlify/functions/direct-email.js`

**Expected Parameters:**
```javascript
{
  email: string,        // Recipient email
  downloadUrl: string,  // R2 download URL
  fileCount: number,    // Number of files
  finalSizeMB: number   // ZIP size in MB
}
```

---

## Bug History & Fixes

### Bug 1: Missing IAM Permissions
**Symptom:** EC2 instances couldn't access SQS  
**Fix:** Added SQS permissions to instance profile  
**File:** `aws-ec2-spot/instance-policy.json`

### Bug 2: Node.js Compatibility
**Symptom:** Node.js 20 failed on Amazon Linux 2 (glibc 2.26 < 2.28)  
**Fix:** Switched to Amazon Linux 2023 AMI  
**File:** `aws-ec2-spot/lambda-function.js` (line ~175)

### Bug 3: Missing Dependencies
**Symptom:** `@aws-sdk/client-ec2` not found  
**Fix:** Added to npm install in user-data  
**File:** Lambda's embedded user-data script

### Bug 4: Archiver Stream Error
**Symptom:** `ArchiverError: input source must be valid Stream or Buffer`  
**Fix:** Convert Web Stream to Node.js stream using `Readable.fromWeb()`  
**File:** `aws-ec2-spot/wedding-photo-processor-streaming-fixed.js` (line ~326)

### Bug 5: Email Parameter Mismatch ⚠️ CRITICAL
**Symptom:** Email failed with "email is required"  
**Root Cause:** Processor sent `{ to, subject, html }` but Netlify expects `{ email, downloadUrl, fileCount, finalSizeMB }`  
**Fix:** Changed sendEmail parameters to match Netlify function  
**File:** `aws-ec2-spot/wedding-photo-processor-streaming-fixed.js` (line ~364)

---

## Deployment Guidelines

### ⚠️ DANGER ZONES

1. **Lambda Function Changes**
   - Lambda launches EC2 instances with embedded user-data
   - User-data downloads processor from GitHub
   - **If you edit Lambda locally and deploy, you MUST commit processor changes to GitHub first!**

2. **Direct AWS Updates**
   - Shell scripts in `aws-ec2-spot/` can update AWS directly
   - These bypass Git commits
   - **Always commit AND push before running deployment scripts!**

### Safe Deployment Process

1. **Edit processor file:**
   ```bash
   vim aws-ec2-spot/wedding-photo-processor-streaming-fixed.js
   ```

2. **Commit to GitHub:**
   ```bash
   git add aws-ec2-spot/wedding-photo-processor-streaming-fixed.js
   git commit -m "Fix: Description of change"
   git push
   ```

3. **Wait for GitHub (~10 seconds)** to ensure file is available

4. **Update Lambda if needed:**
   ```bash
   cd aws-ec2-spot
   zip lambda-deployment.zip lambda-function.js
   aws lambda update-function-code --function-name wedding-photo-spot-launcher --zip-file fileb://lambda-deployment.zip
   ```

5. **Terminate old instances:**
   ```bash
   aws ec2 describe-instances --filters 'Name=tag:Name,Values=wedding-photo-processor*' 'Name=instance-state-name,Values=running'
   aws ec2 terminate-instances --instance-ids <instance-id>
   ```

6. **Purge SQS queue if needed:**
   ```bash
   aws sqs purge-queue --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue
   ```

---

## Testing Procedures

### Test 1: Small Files (✅ PASSED - 230MB)
- Upload 2 video files (~200MB + 30MB)
- Verify ZIP creation
- Verify email delivery

### Test 2: Large Single File (🔄 PENDING)
- Upload 1.5GB video file
- Verify streaming handles large files
- Verify no memory issues
- Verify email delivery

### Test 3: Many Files (🔄 PENDING)
- Upload 50+ media files
- Verify archiver handles many files
- Verify email delivery

---

## Monitoring & Debugging

### Check SQS Queue Status
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

### Check Running Instances
```bash
aws ec2 describe-instances \
  --filters 'Name=tag:Name,Values=wedding-photo-processor*' 'Name=instance-state-name,Values=running,pending' \
  --query 'Reservations[*].Instances[*].[InstanceId,LaunchTime,PublicIpAddress,State.Name,IamInstanceProfile.Arn]' \
  --output table
```

### SSH to Instance
```bash
ssh -i aws-ec2-spot/wedding-photo-spot-key.pem ec2-user@<PUBLIC_IP>

# Check logs
sudo tail -f /var/log/user-data.log
sudo tail -f /app/logs/processor.log
sudo tail -f /app/logs/processor-error.log
sudo journalctl -u wedding-streaming-processor -f
```

### Common Log Locations
- Bootstrap: `/var/log/user-data.log`
- Application: `/app/logs/processor.log`
- Errors: `/app/logs/processor-error.log`
- Systemd: `journalctl -u wedding-streaming-processor`

---

## Configuration Reference

### Environment Variables (Set in Lambda's user-data)
```bash
R2_ACCOUNT_ID=98a9cce92e578cafdb9025fa24a6ee7e
R2_ACCESS_KEY_ID=06da59a3b3aa1315ed2c9a38efa7579e
R2_SECRET_ACCESS_KEY=e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27
R2_BUCKET_NAME=sharedmoments-photos-production
R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com
AWS_SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue
AWS_REGION=us-east-1
NETLIFY_EMAIL_ENDPOINT=https://sharedmoments.socialboostai.com/.netlify/functions/direct-email
```

### AWS Resources
- **Lambda Function:** `wedding-photo-spot-launcher`
- **SQS Queue:** `wedding-photo-processing-queue`
- **IAM Instance Profile:** `wedding-photo-processor-profile`
- **EC2 AMI:** `ami-052064a798f08f0d3` (Amazon Linux 2023)
- **Instance Type:** `t3.medium` (Spot)
- **Security Group:** `sg-0179ab194345abc19`
- **SSH Key:** `wedding-photo-spot-key`

---

## Success Indicators

When working correctly:

1. **Lambda logs:** "Job queued successfully"
2. **EC2 launches:** Within 30 seconds
3. **Bootstrap:** Completes in ~90 seconds
4. **SQS:** Message goes from "Available" → "NotVisible" → Deleted
5. **Processor logs:**
   - "📦 Received streaming job"
   - "🌊 Starting streaming ZIP creation"
   - "✅ Upload to R2 completed"
   - "📧 Sending email notification..."
   - "✅ Email sent successfully"
6. **User receives email:** Within 2-3 minutes of upload

---

## Rollback Procedure

If something breaks:

1. **Check Git history:**
   ```bash
   git log --oneline aws-ec2-spot/wedding-photo-processor-streaming-fixed.js
   ```

2. **Revert to working commit:**
   ```bash
   git revert <commit-hash>
   git push
   ```

3. **Terminate broken instances**

4. **Purge SQS queue**

5. **Test with new request**

---

## Final Notes

- **Always test after changes**
- **Monitor CloudWatch logs**
- **Instances auto-terminate after 5 minutes idle**
- **Cost per job: ~$0.01-0.02**
- **Processing time: 2-3 minutes for 230MB**

**Last successful test:** October 12, 2025 - 230MB (2 files)  
**Commit:** 7d18027 - "Fix: Email parameter mismatch - send 'email' not 'to' to Netlify function"
