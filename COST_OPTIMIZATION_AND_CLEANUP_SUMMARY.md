# Cost Optimization and Cleanup Summary

## Cleanup Completed (July 21, 2025)

### Terminated Instances
1. **i-0ae1995a8a73c1451** - Was running for 4+ hours (old test instance without auto-shutdown)
2. **i-046a08918ddbe6a71** - Stopped instance (terminated)
3. **i-0fc46494eba94c682** - Stopped instance (terminated)

### Active Resources (DO NOT DELETE)
- **Lambda**: `wedding-photo-spot-launcher` (only one, as intended)
- **SQS Queue**: `wedding-photo-processing-queue`
- **IAM Roles**: `wedding-photo-spot-lambda-role`, `wedding-photo-spot-ec2-role`
- **Instance Profile**: `wedding-photo-spot-profile`
- **EC2 Key Pair**: `wedding-photo-spot-key`

## Cost Optimization Features

### 1. Auto-Shutdown (CONFIRMED WORKING)
```javascript
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Check for idle timeout
if (Date.now() - lastActivity > IDLE_TIMEOUT) {
  console.log('⏰ Idle timeout reached, shutting down...');
  require('child_process').exec('sudo shutdown -h now');
  process.exit(0);
}
```

### 2. Spot Instances
- Using **t3.medium spot** instances (~70% cheaper than on-demand)
- Typical cost: $0.01-0.02 per processing job

### 3. Instance Reuse
- Lambda checks for existing instances before launching new ones
- Multiple jobs can use the same instance if received within 10 minutes

### 4. Efficient Routing
- Small files (<80MB) process in Cloudflare (no EC2 cost)
- Only large files trigger EC2 instances

## Cost Breakdown

### Per Request Costs
- **Lambda invocation**: ~$0.0000002
- **SQS messages**: ~$0.0000004
- **EC2 Spot (t3.medium)**: ~$0.0116/hour
- **Average job duration**: 3-5 minutes
- **Total per job**: ~$0.01-0.02

### Monthly Estimates (assuming 100 large file requests)
- Lambda: ~$0.02
- SQS: ~$0.04
- EC2 Spot: ~$1-2
- **Total**: ~$2-3/month

## Monitoring Commands

### Check Running Instances
```bash
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query "Reservations[*].Instances[*].[InstanceId,LaunchTime,PublicIpAddress]" \
  --output table \
  --region us-east-1
```

### Check SQS Queue
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names All \
  --region us-east-1
```

### View Lambda Invocations
```bash
aws logs tail /aws/lambda/wedding-photo-spot-launcher \
  --follow \
  --region us-east-1
```

## Important Notes

1. **Auto-shutdown is working** - New instances will terminate after 10 minutes idle
2. **No persistent instances** - All instances are ephemeral
3. **Cost-efficient** - Only pay for actual processing time
4. **Monitored** - Use commands above to verify no runaway instances

## Red Flags to Watch For
- Instance running > 30 minutes (investigate immediately)
- Multiple instances running simultaneously (shouldn't happen)
- SQS messages stuck in queue > 1 hour

## Google Cloud Run Cleanup (July 21, 2025)

### Issue Identified
- Netlify logs showing "Routing to Google Cloud Run" errors
- Google Cloud Run returning 404 errors
- This was from an older routing configuration

### Resolution
- Removed all Google Cloud deployment scripts:
  - `deploy-cloud-run-fix.sh`
  - `deploy-google-cloud-fix.sh`
  - `setup-cloud-run-env.sh`
  - `setup-google-cloud.sh`
- Current code already routes to Cloudflare Worker (no code changes needed)
- **IMPORTANT**: Need to redeploy Netlify functions to use updated routing

### To Fix the Issue
```bash
# Redeploy Netlify functions with current code
netlify deploy --prod
```

Last cleanup performed: July 21, 2025, 9:15 PM PST
