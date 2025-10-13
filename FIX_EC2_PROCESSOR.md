# Fix EC2 Processor - Messages Stuck in SQS

## Problem Summary

**3 messages stuck in SQS** - EC2 is running but NOT processing them.

### Root Causes:

1. **Node.js version too old**: EC2 has Node v16.20.2, AWS SDK requires Node >=18
2. **Service is running but broken**: The processor started but can't actually function properly with old Node version
3. **Messages arrived before EC2 was ready**: Your request at 00:05:23, EC2 ready at 00:07:50 (2.5 minute startup delay)

## Immediate Fix Options

### Option 1: Quick Manual Fix (5 minutes)

Connect to the EC2 instance and manually process the stuck messages:

```bash
# 1. Get instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running" \
  --region us-east-1 \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# 2. Connect via SSM
aws ssm start-session --target $INSTANCE_ID --region us-east-1

# 3. Once connected, upgrade Node.js
sudo su -
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs

# 4. Verify Node version
node -v  # Should show v20.x.x

# 5. Restart the processor
systemctl restart wedding-processor

# 6. Watch the logs
journalctl -u wedding-processor -f
```

You should see it start processing the 3 stuck messages immediately!

### Option 2: Fix the User-Data Script (Permanent Fix)

The `user-data.sh` script needs to install Node 18+ instead of Node 16.

**File to fix**: `aws-ec2-spot/user-data.sh`

**Change line 10-15 from:**
```bash
# Install Node.js 16
curl -sL https://rpm.nodesource.com/setup_16.x | bash -
yum install -y nodejs git
```

**To:**
```bash
# Install Node.js 20 (required for AWS SDK v3)
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs git

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
```

Then redeploy the Lambda with the fixed user-data script.

### Option 3: Terminate and Restart (Nuclear Option)

```bash
# 1. Terminate the broken instance
aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region us-east-1

# 2. Wait for termination
aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID --region us-east-1

# 3. Trigger a new download request
# The Lambda will launch a new instance with the (hopefully fixed) user-data
```

## What I Recommend

**Do Option 1 first** (quick manual fix) to unblock the 3 stuck messages and get your emails sent NOW.

**Then do Option 2** (fix the script) so future instances work correctly.

## After the Fix

Once Node 20 is installed and the processor restarts, you should see in the logs:

```
📦 Received job for eventId: YOUR_EVENT_ID (2 files)
📥 Downloading files...
📦 Creating ZIP archive...
☁️ Uploading to R2...
✅ Upload complete: https://...
📧 Sending email notification...
✅ Job completed and message deleted from queue
```

Then check your email (and spam folder)!

## Prevention

To prevent this in the future:

1. **Fix user-data.sh** to use Node 20
2. **Add health check** to Lambda - don't queue jobs if EC2 isn't ready
3. **Pre-warm an instance** - keep one running during peak hours
4. **Add retry logic** - if email fails, retry or alert

## Need Help?

If you can't connect via SSM, you can also:
1. Stop the instance
2. Create an AMI with Node 20 pre-installed
3. Update Lambda to use the new AMI
4. Start a new instance

Let me know if you need help with any of these steps!
