# EC2 Instance Auto-Shutdown Fix

## Problem Summary

Your EC2 instances were staying running because:

1. **Lambda was reusing instances indefinitely** - The Lambda function checked for existing instances and kept using them instead of letting them auto-terminate
2. **Long idle timeout** - Instances had a 15-minute idle timeout, costing more money
3. **Missing auto-termination code** - The base processor didn't have self-termination logic

## Changes Made

### 1. Lambda Function (`aws-ec2-spot/lambda-function.js`)

**Changed behavior:**
- Now checks instance age when finding existing instances
- Only reuses instances if they're less than 2 minutes old (still starting up)
- Older instances are left to process queued jobs and auto-terminate
- Updated response messages to indicate "Instance will auto-terminate after 5min of inactivity"

### 2. Processor Scripts

Updated both `wedding-photo-processor.js` and `wedding-photo-processor-streaming-fixed.js`:

**Added auto-termination features:**
- Import `EC2Client` and `TerminateInstancesCommand` from AWS SDK
- New `getInstanceId()` function to fetch instance metadata
- New `terminateInstance()` function that:
  - Gets its own instance ID
  - Calls EC2 API to terminate itself
  - Logs how many jobs were processed
- Reduced idle timeout from 15 minutes to **5 minutes** (saves costs!)
- Improved idle check to only terminate when NOT processing
- Added graceful shutdown handlers for SIGTERM and SIGINT

**Key improvements:**
- Instances now terminate themselves after 5 minutes of no queue activity
- Graceful shutdown ensures current jobs complete before terminating
- Tracks and logs number of jobs processed before shutdown

### 3. IAM Permissions

**Already configured correctly!** ✅
- The instance profile `wedding-photo-spot-profile` already has:
  - `ec2:DescribeInstances` permission
  - `ec2:TerminateInstances` permission
- No IAM changes needed

## How It Works Now

### Flow:

1. **User submits download request** → Lambda is triggered
2. **Lambda queues the job** → Sends job data to SQS queue
3. **Lambda checks for existing instances:**
   - If no instances running → Launch new spot instance
   - If instance < 2 min old → Use it (still starting up)
   - If instance > 2 min old → Use it (already processing from queue)
4. **EC2 instance processes jobs from queue:**
   - Polls SQS every 20 seconds
   - Processes jobs one at a time
   - Deletes completed jobs from queue
5. **Auto-termination after idle:**
   - If no jobs in queue for 5 minutes → Instance terminates itself
   - Graceful shutdown ensures current job completes first

### Cost Savings:

- **Before:** Instances could run indefinitely (~$0.0104/hour × 24 = $0.25/day)
- **After:** Instances terminate after 5 min idle (~$0.0104/hour × 0.083 = $0.0009 per idle period)
- **Savings:** ~99% reduction in idle costs!

## Deployment

### Option 1: Deploy Lambda Only (Recommended)

The Lambda changes take effect immediately for new instance launches:

```bash
cd aws-ec2-spot
./deploy-lambda.sh
```

Existing instances will continue using old code until they're terminated manually or replaced.

### Option 2: Full Redeploy

To update both Lambda and force new instances with updated code:

```bash
cd aws-ec2-spot

# 1. Deploy updated Lambda
./deploy-lambda.sh

# 2. Manually terminate any running instances (they'll be replaced on next job)
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].InstanceId' \
  --output text | xargs -I {} aws ec2 terminate-instances --instance-ids {}
```

### Option 3: Test First

Deploy to a test stack first:

```bash
# Update the Lambda function code in AWS console manually
# Or use AWS CLI to update just the function code
cd aws-ec2-spot
zip -r lambda.zip lambda-function.js node_modules/

aws lambda update-function-code \
  --function-name wedding-photo-spot-launcher \
  --zip-file fileb://lambda.zip
```

## Verification

### 1. Check Lambda Logs

```bash
aws logs tail /aws/lambda/wedding-photo-spot-launcher --follow
```

Look for:
- `ℹ️ Found existing instance: i-xxxxx (age: X min)`
- `⏳ Instance is still starting up, not launching another`
- `✅ Active instance found - job will be processed from queue`

### 2. Check EC2 Instance Logs

```bash
# Get the instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# Check CloudWatch logs
aws logs tail /wedding-photo-processor/application --follow
```

Look for:
- `⏰ Idle timeout reached (5 minutes), terminating instance...`
- `🔪 Terminating instance i-xxxxx after processing X jobs`
- `✅ Instance termination initiated`

### 3. Monitor Instance Lifecycle

```bash
# Watch instances come and go
watch -n 5 'aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" \
  --query "Reservations[*].Instances[*].[InstanceId,State.Name,LaunchTime]" \
  --output table'
```

You should see:
- Instances launch when jobs arrive
- Instances terminate 5 minutes after last job completes

## Environment Variables

**No environment variables needed from you!** 

All credentials are already configured in the user-data scripts:
- R2 credentials (Cloudflare R2 storage)
- SQS queue URL
- AWS region
- Netlify email endpoint

These are hardcoded in:
- `aws-ec2-spot/user-data-auto-terminate.sh`
- `aws-ec2-spot/user-data-streaming.sh`

## Troubleshooting

### Instance won't terminate

1. **Check IAM permissions:**
```bash
aws iam get-role-policy \
  --role-name wedding-photo-spot-role \
  --policy-name instance-policy
```

Should show `ec2:TerminateInstances` permission.

2. **Check instance metadata service:**
```bash
# SSH into instance
ssh -i your-key.pem ec2-user@instance-ip

# Test metadata service
curl http://169.254.169.254/latest/meta-data/instance-id
```

3. **Check processor logs:**
```bash
# On the EC2 instance
tail -f /app/logs/processor.log
```

### Instance terminates too quickly

If you need longer processing time, edit the timeout:

```javascript
// In wedding-photo-processor-streaming-fixed.js
const IDLE_TIMEOUT = 10 * 60 * 1000; // Change to 10 minutes
```

### Too many instances launching

The Lambda prevents duplicate launches by checking for instances < 2 min old.
If you need tighter control, reduce this threshold:

```javascript
// In lambda-function.js, line 115
if (instanceAge < 120000) { // Change to 60000 for 1 minute
```

## Next Steps

1. ✅ Deploy the updated Lambda function
2. ✅ Monitor the first few jobs to confirm auto-termination works
3. ✅ Check your AWS bill in a few days to see cost savings
4. Consider setting up CloudWatch alarms for:
   - Instances running > 30 minutes (potential stuck instance)
   - Lambda errors
   - SQS queue depth

## Cost Estimate

**Typical workflow:**
- 1 download request → Launch instance
- Instance processes job: 2-3 minutes
- Instance waits for more jobs: 5 minutes idle
- Instance terminates itself
- **Total runtime:** ~7-8 minutes
- **Cost per job:** ~$0.001 (one-tenth of a penny!)

**Multiple requests:**
- If jobs arrive within 5 minutes of each other → Same instance handles them
- Each additional job adds ~2-3 minutes runtime
- Instance terminates 5 minutes after last job

**Example monthly cost (100 downloads):**
- 100 jobs × ~8 min average = 800 minutes = 13.3 hours
- 13.3 hours × $0.0104/hour = **$0.14/month**
- vs. 24/7 instance: 720 hours × $0.0104 = **$7.49/month**
- **Savings: 98%** 🎉
