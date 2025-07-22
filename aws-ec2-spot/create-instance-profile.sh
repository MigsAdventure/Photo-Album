#!/bin/bash
set -e

echo "🔧 Creating IAM role and instance profile for CloudWatch Logs..."

# Create IAM role
ROLE_NAME="wedding-photo-spot-role"
echo "Creating IAM role: $ROLE_NAME"

# Create trust policy
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
aws iam create-role \
  --role-name $ROLE_NAME \
  --assume-role-policy-document file://trust-policy.json

echo "✅ IAM role created: $ROLE_NAME"

# Attach S3 and SQS policies
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess

echo "✅ Attached S3 and SQS policies"

# Create instance profile
PROFILE_NAME="wedding-photo-spot-profile"
aws iam create-instance-profile \
  --instance-profile-name $PROFILE_NAME

echo "✅ Created instance profile: $PROFILE_NAME"

# Add role to instance profile
aws iam add-role-to-instance-profile \
  --instance-profile-name $PROFILE_NAME \
  --role-name $ROLE_NAME

echo "✅ Added role to instance profile"

# Create CloudWatch Logs policy
aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name CloudWatchLogsPolicy \
  --policy-document file://cloudwatch-logs-policy.json

echo "✅ Attached CloudWatch Logs policy to role"

echo "✅ IAM setup complete!"
echo "Instance profile name: $PROFILE_NAME"