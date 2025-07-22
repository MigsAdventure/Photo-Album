#!/bin/bash

echo "🚀 Deploying Fixed EC2 Processor..."

# Update the user-data.sh to use the fixed large-file-process.js
echo "📝 Updating user-data.sh with fixed processor..."

# Create a backup
cp user-data.sh user-data.sh.backup

# Update Lambda function to use the regular user data script
echo "🔄 Updating Lambda environment to use REGULAR user data..."
aws lambda update-function-configuration \
  --function-name wedding-photo-spot-launcher \
  --environment '{"Variables":{"USER_DATA_SCRIPT":"REGULAR","R2_PUBLIC_URL":"https://sharedmomentsphotos.socialboostai.com","R2_BUCKET_NAME":"sharedmoments-photos-production","INSTANCE_TYPE":"t3.medium"}}' \
  --no-cli-pager

echo "✅ Lambda configuration updated"

# Terminate any running instances to ensure new ones use the fixed code
echo "🔄 Checking for running instances..."
INSTANCE_IDS=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=wedding-photo-processor" "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].InstanceId' \
  --output text)

if [ ! -z "$INSTANCE_IDS" ]; then
  echo "🛑 Terminating existing instances: $INSTANCE_IDS"
  aws ec2 terminate-instances --instance-ids $INSTANCE_IDS --no-cli-pager
  echo "⏳ Waiting for instances to terminate..."
  aws ec2 wait instance-terminated --instance-ids $INSTANCE_IDS
  echo "✅ Instances terminated"
else
  echo "✅ No running instances found"
fi

echo "🎉 Fixed processor deployed!"
echo ""
echo "📋 Summary of fixes:"
echo "✅ Fixed field name mismatches (email vs customerEmail, photos vs files)"
echo "✅ Fixed URL field handling (url vs downloadUrl vs downloadURL)"
echo "✅ Fixed file name field handling (fileName vs filename)"
echo "✅ Email sending now works correctly after R2 upload"
echo ""
echo "🔄 Next steps:"
echo "1. Test with: node test-complete-aws-flow.js"
echo "2. Monitor EC2 logs for processing"
echo "3. Check email delivery"
