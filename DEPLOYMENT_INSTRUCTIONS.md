# Deployment Instructions - EC2 Processor Fix

## Changes Made

✅ **Fixed**: `aws-ec2-spot/user-data.sh` now installs Node.js 20 instead of Node 16

This will fix the issue where the processor couldn't run because AWS SDK v3 requires Node >=18.

## What to Do Next

### Step 1: Fix Current Broken Instance (Immediate - Get Your Emails Now!)

```bash
# Get the running instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running" \
  --region us-east-1 \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

echo "Connecting to instance: $INSTANCE_ID"

# Connect via SSM
aws ssm start-session --target $INSTANCE_ID --region us-east-1
```

**Once connected to EC2, run these commands:**
```bash
sudo su -

# Upgrade Node.js to v20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs

# Verify version
node -v  # Should show v20.x.x

# Restart the processor
systemctl restart wedding-processor

# Watch the logs - you should see it processing the 3 stuck messages
journalctl -u wedding-processor -f
```

**Expected output:**
```
📦 Received job for eventId: YOUR_EVENT_ID (2 files)
📥 Downloading files...
📦 Creating ZIP archive...
☁️ Uploading to R2...
📧 Sending email notification...
✅ Job completed and message deleted from queue
```

Your 3 emails should arrive within a few minutes!

### Step 2: Deploy Updated Lambda (Permanent Fix)

The Lambda function loads the user-data.sh script and uses it to launch EC2 instances. We need to update the Lambda with the fixed script.

**Option A: If Lambda has the script embedded:**

```bash
cd aws-ec2-spot

# Package the Lambda with updated user-data.sh
zip -r lambda-deployment.zip lambda-function.js user-data.sh package.json

# Update Lambda
aws lambda update-function-code \
  --function-name wedding-photo-spot-launcher \
  --zip-file fileb://lambda-deployment.zip \
  --region us-east-1

echo "✅ Lambda updated with fixed user-data script"
```

**Option B: If using a deployment script:**

```bash
cd aws-ec2-spot
./deploy-lambda.sh  # Or whatever your deployment script is called
```

### Step 3: Test the Fix

```bash
# Trigger a test by requesting a download
# The Lambda should launch a new EC2 with Node 20

# Or manually test Lambda
aws lambda invoke \
  --function-name wedding-photo-spot-launcher \
  --payload '{"eventId":"test-123","email":"your-email@example.com","photos":[]}' \
  --region us-east-1 \
  response.json

cat response.json
```

### Step 4: Commit the Fix

```bash
git add aws-ec2-spot/user-data.sh
git commit -m "Fix: Upgrade Node.js from v16 to v20 in EC2 user-data script

- AWS SDK v3 requires Node.js >=18
- Previous Node v16 caused processor to fail silently
- Messages were getting stuck in SQS queue
- This fixes the download email delivery issue"

git push
```

## Verification

### Check SQS Queue (should be empty after fix):
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-1
```

Expected: `"ApproximateNumberOfMessages": "0"`

### Check Your Email
- Check inbox for download links
- Check spam folder
- Email should come from your configured sender

### Test New Instance
After deploying the Lambda update, trigger a new download request and verify:
1. EC2 launches with Node 20
2. Processor starts successfully
3. Messages are processed from SQS
4. Email is delivered

## Troubleshooting

### If email still doesn't arrive after manual fix:

Check the email sending part:
```bash
# On EC2, check logs
journalctl -u wedding-processor -n 100 --no-pager | grep -i email
```

Look for errors like:
- `❌ Failed to send email`
- Email credentials missing
- Netlify endpoint unreachable

### If processor won't start after Node upgrade:

```bash
# Check service status
systemctl status wedding-processor

# Check for errors
journalctl -u wedding-processor -n 50 --no-pager
```

### If SQS messages still stuck:

```bash
# Manually receive and inspect messages
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --max-number-of-messages 1 \
  --region us-east-1
```

## Summary

1. ✅ **Immediate**: Connect to EC2 and upgrade Node to v20 (fixes current stuck messages)
2. ✅ **Deploy**: Update Lambda with fixed user-data.sh (fixes future instances)
3. ✅ **Commit**: Save the fix to git
4. ✅ **Verify**: Test that new instances work correctly

Your download emails should work now! 🎉
