# EC2 Processing Issue - Most Likely Causes

## What We Know
- ✅ EC2 instance is RUNNING
- ✅ Lambda successfully queued message to SQS
- ❌ Email never received

## Most Likely Issues

### 1. EC2 Processor Not Running ⚠️ (MOST LIKELY)

The EC2 instance might be running, but the **processor script might not have started**.

**How to Check:**
```bash
# Connect to EC2
aws ssm start-session --target i-YOUR-INSTANCE-ID

# Check if processor is running
ps aux | grep "wedding-photo-processor.js"
ps aux | grep "node"

# Check systemd service (if it's set up as a service)
sudo systemctl status wedding-photo-processor

# Check processor logs
tail -f /var/log/user-data.log
tail -f /var/log/cloud-init-output.log
```

**If processor is NOT running:**
```bash
# Manually start it
cd /home/ec2-user/wedding-photo-processor
node wedding-photo-processor.js
```

### 2. Environment Variables Missing

The processor requires these environment variables:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`
- `AWS_SQS_QUEUE_URL`
- `AWS_REGION`

**Check in user-data script:**
Look at `aws-ec2-spot/user-data-auto-terminate.sh` - are all these variables set?

**How to verify on EC2:**
```bash
# Check environment
env | grep "R2_\|AWS_"
```

### 3. SQS Permissions

EC2 instance needs IAM role with permission to:
- Read from SQS queue
- Delete from SQS queue

**Check IAM Role:**
1. AWS Console → EC2 → Your Instance
2. Look at "IAM Role" attached
3. Check if role has `sqs:ReceiveMessage` and `sqs:DeleteMessage` permissions

### 4. Wrong SQS Queue URL

The processor might be polling the **wrong** queue.

**Check:**
- Queue URL in Lambda: `https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue`
- Queue URL in EC2 env vars: Should match exactly

### 5. Processor Crashed During Startup

The user-data script might have failed to install dependencies or start the processor.

**Check user-data logs:**
```bash
# On EC2
sudo cat /var/log/cloud-init-output.log
sudo cat /var/log/user-data.log
```

Look for errors during:
- Node.js installation
- npm install
- Script startup

## Quick Diagnostic

### Run this on your local machine:

```bash
# 1. Check SQS queue
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
  --region us-east-1

# Output should show:
# "ApproximateNumberOfMessages": "1"  <- Message is waiting
# OR
# "ApproximateNumberOfMessages": "0"  <- Message was processed

# 2. Get EC2 instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running" \
  --region us-east-1 \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

echo "Instance ID: $INSTANCE_ID"

# 3. Get EC2 console output
aws ec2 get-console-output \
  --instance-id $INSTANCE_ID \
  --region us-east-1 \
  --output text > ec2-console-output.txt

# Check the file for errors
grep -i "error\|failed\|missing" ec2-console-output.txt
```

## What to Look For

### In EC2 Console Output:

**Good signs (processor started successfully):**
```
🚀 Wedding photo processor started
📊 Configuration loaded from environment variables
Health check server running on port 8080
```

**Bad signs (processor failed to start):**
```
❌ Missing required environment variable: R2_ACCOUNT_ID
Error: Cannot find module 'archiver'
permission denied
```

### In SQS:

**Message stuck (ApproximateNumberOfMessages > 0):**
- EC2 is NOT polling SQS
- Either processor isn't running or can't connect to SQS

**Message gone (ApproximateNumberOfMessages = 0):**
- Either EC2 processed it successfully but email failed
- OR message expired/was deleted

## My Bet

Based on the code, I think **the processor script never started** on EC2. The instance is running but the Node.js script isn't.

**Why?**
- User-data script might have failed
- Dependencies (Node.js, npm packages) might not have installed
- Environment variables might be missing
- Script path might be wrong

## Next Steps

1. **Check SQS queue count** - tells us if message is waiting
2. **Get EC2 console output** - tells us what happened during startup
3. **Connect to EC2 and manually run processor** - bypass startup issues

Share the outputs with me and I'll pinpoint the exact problem!
