# Wedding Photo App - Complete Working Architecture Documentation

## Overview
This document captures the exact working state of the wedding photo application's email download system, which successfully handles large video collections (500MB+) using a cost-efficient serverless architecture.

## Current Production Flow

### 1. Frontend (React App)
- **URL**: https://sharedmoments.socialboostai.com
- **Hosting**: Netlify
- **Function**: Users upload photos/videos to Firebase Storage, then request email download

### 2. Netlify Function Entry Point
- **Endpoint**: `https://sharedmoments.socialboostai.com/.netlify/functions/email-download`
- **Function**: Receives download request and routes to Cloudflare Worker
- **Key Parameters**: eventId, email address

### 3. Cloudflare Worker (Router/Orchestrator)
- **URL**: `https://sharedmoments-photo-processor.migsub77.workers.dev`
- **Account ID**: `98a9cce92e578cafdb9025fa24a6ee7e`
- **Function**: 
  - Analyzes collection size
  - Routes small files (<80MB) to direct processing
  - Routes large files (>80MB) to AWS EC2 Spot instances
- **Decision Logic**:
  ```
  if (totalSize > 80MB || any video > 80MB) {
    route to AWS Lambda → EC2 Spot
  } else {
    process directly in Cloudflare
  }
  ```

### 4. AWS Lambda (EC2 Spot Launcher)
- **Function Name**: `wedding-photo-spot-launcher`
- **URL**: `https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/`
- **Region**: us-east-1
- **Function**: 
  - Adds job to SQS queue
  - Launches EC2 Spot instance if none running
  - Returns job status to Cloudflare Worker

### 5. AWS SQS Queue
- **Queue URL**: `https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue`
- **Region**: us-east-1
- **Message Retention**: 1 hour
- **Function**: Holds processing jobs for EC2 instances

### 6. EC2 Spot Instance (Processor)
- **Instance Type**: t3.medium (spot)
- **AMI**: Amazon Linux 2
- **Key Name**: `wedding-photo-spot-key`
- **Instance Profile**: `wedding-photo-spot-profile`
- **Auto-shutdown**: After 10 minutes of inactivity
- **Function**:
  1. Polls SQS queue for jobs
  2. Downloads files from Firebase Storage
  3. Creates ZIP archive
  4. Uploads to Cloudflare R2
  5. Sends email via Netlify function

### 7. Cloudflare R2 Storage
- **Bucket**: `sharedmoments-photos-production`
- **Public URL**: `https://sharedmomentsphotos.socialboostai.com`
- **Access Key ID**: `06da59a3b3aa1315ed2c9a38efa7579e`
- **Account ID**: `98a9cce92e578cafdb9025fa24a6ee7e`

### 8. Email Service (Netlify Function)
- **Endpoint**: `https://sharedmoments.socialboostai.com/.netlify/functions/direct-email`
- **Function**: Sends email with download link to user
- **Email contains**: Download URL, file count, total size

## Cost Optimization Features

1. **EC2 Spot Instances**: ~70% cheaper than on-demand
2. **Auto-shutdown**: Instances terminate after 10 minutes idle
3. **Instance Reuse**: New jobs reuse existing instances if available
4. **Efficient Routing**: Only large files go to EC2, small files process in Cloudflare

## Current Active Resources

### Lambda Functions
- `wedding-photo-spot-launcher` (ACTIVE - DO NOT DELETE)

### IAM Roles
- `wedding-photo-spot-lambda-role` (ACTIVE - DO NOT DELETE)
- `wedding-photo-spot-ec2-role` (ACTIVE - DO NOT DELETE)

### Instance Profile
- `wedding-photo-spot-profile` (ACTIVE - DO NOT DELETE)

### SQS Queue
- `wedding-photo-processing-queue` (ACTIVE - DO NOT DELETE)

### EC2 Key Pair
- `wedding-photo-spot-key` (ACTIVE - DO NOT DELETE)

## Key Configuration Files

### 1. Lambda Function (`aws-ec2-spot/lambda-function.js`)
- Launches EC2 Spot instances
- Manages SQS queue

### 2. EC2 User Data Script (`aws-ec2-spot/user-data.sh`)
- Contains all processing logic
- R2 credentials
- Email endpoint configuration

### 3. Cloudflare Worker (`cloudflare-worker/src/index.js`)
- Routing logic
- AWS Lambda integration

### 4. Netlify Functions
- `netlify/functions/email-download.js` - Entry point
- `netlify/functions/direct-email.js` - Email sender

## Testing Endpoints

### Test Lambda Directly
```bash
node aws-ec2-spot/test-email-fixed-flow.js
```

### Monitor SQS Queue
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue \
  --attribute-names All \
  --region us-east-1
```

### Check EC2 Instances
```bash
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query "Reservations[*].Instances[*].[InstanceId,PublicIpAddress,State.Name,Tags[?Key=='Name'].Value|[0]]" \
  --output table \
  --region us-east-1
```

## Important Notes

1. **Auto-shutdown Timing**: EC2 instances should auto-terminate after 10 minutes of no SQS messages
2. **Email Endpoint**: Must use `https://sharedmoments.socialboostai.com/.netlify/functions/direct-email`
3. **R2 Credentials**: Stored in EC2 user-data script
4. **Cost**: Approximately $0.01-0.02 per processing job

## DO NOT DELETE
This architecture is currently working in production. Before making any changes:
1. Document current state
2. Test in isolation
3. Have rollback plan

Last verified working: July 21, 2025
