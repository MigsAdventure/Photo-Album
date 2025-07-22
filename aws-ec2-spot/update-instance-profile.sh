#!/bin/bash
set -e

# Get the instance profile name
PROFILE_NAME=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=wedding-photo-processor" --query "Reservations[0].Instances[0].IamInstanceProfile.Arn" --output text | awk -F/ '{print $2}')

if [ -z "$PROFILE_NAME" ]; then
  echo "❌ No instance profile found for wedding-photo-processor"
  exit 1
fi

echo "✅ Found instance profile: $PROFILE_NAME"

# Create CloudWatch Logs policy
POLICY_ARN=$(aws iam create-policy --policy-name wedding-photo-cloudwatch-logs --policy-document file://cloudwatch-logs-policy.json --query "Policy.Arn" --output text)

echo "✅ Created policy: $POLICY_ARN"

# Attach policy to role
ROLE_NAME=$(aws iam get-instance-profile --instance-profile-name $PROFILE_NAME --query "InstanceProfile.Roles[0].RoleName" --output text)

echo "✅ Found role: $ROLE_NAME"

aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn $POLICY_ARN

echo "✅ Attached CloudWatch Logs policy to role"

echo "✅ Instance profile updated successfully"
