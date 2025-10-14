# EC2 Processing Diagnosis - Request 53gvnj7pc

## Current Status
- ✅ Cloudflare Worker routed to AWS Lambda
- ✅ Lambda launched EC2 instance  
- ✅ EC2 instance is RUNNING
- ❌ Email never received

## Where to Look

### 1. Check EC2 CloudWatch Logs (MOST IMPORTANT)

The EC2 instance should be logging to CloudWatch. Check these log groups:

**Log Groups to Check:**
- `/wedding-photo-processor/application`
- `/wedding-photo-processor/system`
- `/wedding-photo-processor/bootstrap`
- OR check the EC2 instance's console output

**How to Check:**
```bash
# AWS Console:
1. Go to CloudWatch → Log Groups
2. Search for "wedding-photo"
3. Look at streams from Oct 13, 00:05:23 onwards
4. Search for request ID: 53gvnj7pc

# OR using AWS CLI:
aws logs tail /wedding-photo-processor/application --follow --since 1h
```

**What to look for:**
- ✅ `Processing queue job [53gvnj7pc]` - EC2 picked up the job
- ✅ `Downloading from Firebase...` - Started downloading files
- ❌ Any error messages
- ❌ Download timeouts
- ❌ ZIP creation errors
- ❌ Email sending errors

### 2. Check SQS Queue Status

**AWS Console:**
1. Go to SQS → `wedding-photo-processing-queue`
2. Check metrics:
   - **Messages Available**: Should be 0 if EC2 processed it
   - **Messages In Flight**: Should be 0 if completed
   - **Messages in Dead Letter Queue**: Check for failures

**Using AWS CLI:**
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names All \
  --region us-east-1
```

**What it means:**
- **Messages Available > 0**: EC2 is not polling SQS (check if processor is running)
- **Messages In Flight > 0**: EC2 picked it up but hasn't finished/deleted it yet
- **Messages = 0**: Message was either processed or disappeared

### 3. Check EC2 Instance Details

**Get Instance ID:**
```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running" \
  --region us-east-1 \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text
```

**Check EC2 System Log (Console Output):**
```bash
# Replace i-xxxxx with your instance ID
aws ec2 get-console-output \
  --instance-id i-xxxxx \
  --region us-east-1 \
  --output text
```

This shows you what the instance is actually doing.

### 4. Connect to EC2 Instance (If Needed)

**Using SSM Session Manager:**
```bash
# Get instance ID first, then:
aws ssm start-session --target i-xxxxx --region us-east-1
```

**Then check:**
```bash
# Check if processor is running
ps aux | grep wedding-photo-processor

# Check processor logs
sudo journalctl -u wedding-photo-processor -f

# Check if it's polling SQS
tail -f /var/log/wedding-photo-processor.log

# Check Node.js process
sudo pm2 logs wedding-photo-processor
```

## Common Issues & Solutions

### Issue 1: EC2 Not Polling SQS
**Symptom**: Messages stuck in SQS, EC2 running but idle

**Check:**
- Is the processor script running on EC2?
- Does EC2 have IAM permissions to read from SQS?
- Is the queue URL correct in EC2 environment?

**Fix:**
```bash
# On EC2 instance
sudo systemctl status wedding-photo-processor
sudo systemctl restart wedding-photo-processor
```

### Issue 2: Firebase Download Failing
**Symptom**: EC2 picks up job but can't download photos

**Log Messages:**
- `❌ Download failed`
- `403 Forbidden`
- `Network timeout`

**Causes:**
- Firebase Storage rules blocking downloads
- Firebase URLs expired
- Network issues

### Issue 3: ZIP Creation Out of Memory
**Symptom**: Process crashes during ZIP creation

**Log Messages:**
- `JavaScript heap out of memory`
- Process killed

**Fix:**
- Check EC2 instance type (should be t3.medium or larger)
- Your 230MB should fit easily, so this is unlikely

### Issue 4: Email Sending Failed
**Symptom**: ZIP created successfully but email not sent

**Check:**
- Email credentials in EC2 environment variables
- Mailgun/SendGrid quota
- Spam folder

**Log Messages:**
- `✅ ZIP created successfully`
- `❌ Failed to send email`

## Quick Diagnostic Commands

### Check if message is in SQS:
```bash
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --max-number-of-messages 10 \
  --region us-east-1
```

### Get EC2 Console Output:
```bash
# First get instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running" \
  --region us-east-1 \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# Then get output
aws ec2 get-console-output --instance-id $INSTANCE_ID --region us-east-1 --output text
```

### Check CloudWatch Logs:
```bash
# List all log streams
aws logs describe-log-streams \
  --log-group-name /wedding-photo-processor/application \
  --order-by LastEventTime \
  --descending \
  --max-items 5 \
  --region us-east-1

# Tail the latest logs
aws logs tail /wedding-photo-processor/application --follow --region us-east-1
```

## What to Share With Me

If you can run these commands and share the output, I can pinpoint the exact issue:

1. **SQS Queue Status:**
   ```bash
   aws sqs get-queue-attributes \
     --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
     --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
     --region us-east-1
   ```

2. **EC2 Console Output (last 100 lines):**
   ```bash
   aws ec2 get-console-output --instance-id i-xxxxx --region us-east-1 --output text | tail -100
   ```

3. **CloudWatch Logs (if they exist):**
   ```bash
   aws logs tail /wedding-photo-processor/application --since 2h --region us-east-1
   ```

With this info, I can tell you exactly what's failing!
