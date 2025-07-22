# EC2 R2 Upload Issue Fixed

## Problem
The EC2 instances were failing to upload ZIP files to R2 with "Unauthorized" errors because they were using incorrect R2 credentials.

## Root Cause
The `user-data.sh` script had incorrect R2 credentials hardcoded:
```javascript
accessKeyId: 'b8c7c0c97171e088cf6b2f2c3c7ec2f0',  // WRONG
secretAccessKey: 'f0aca4b03e979feacc51c09e5a962efac0c1f0e87bb860faca6bf3b3bbfdf91d',  // WRONG
```

## Solution
Updated `user-data.sh` with the correct R2 credentials from `.env`:
```javascript
accessKeyId: '06da59a3b3aa1315ed2c9a38efa7579e',  // CORRECT
secretAccessKey: 'e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27',  // CORRECT
```

## Steps Taken
1. Identified the syntax error in EC2 logs (escaped template literals)
2. Fixed the template literal escaping issue
3. Discovered R2 authentication failures
4. Updated R2 credentials to match `.env`
5. Redeployed Lambda function with correct user-data.sh
6. Terminated EC2 instances with incorrect credentials

## Result
EC2 instances now:
- Download files from Firebase ✅
- Create ZIP archives ✅
- Upload to R2 successfully ✅
- Send email notifications via Netlify ✅

## Testing
```bash
cd aws-ec2-spot && node test-fixed-flow.js
```

## Architecture Flow
1. Netlify → Cloudflare Worker → AWS Lambda → EC2 Spot
2. EC2 downloads from Firebase, zips files, uploads to R2
3. Email sent with R2 download link
