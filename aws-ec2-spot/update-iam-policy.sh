#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}AWS IAM Policy Update Script${NC}"
echo -e "${BLUE}Fixing SQS Permissions for EC2${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Configuration
POLICY_NAME="wedding-photo-processor-policy"
ROLE_NAME="wedding-photo-processor-role"
INSTANCE_PROFILE_NAME="wedding-photo-processor-profile"
POLICY_FILE="aws-ec2-spot/instance-policy.json"

# Check if policy file exists
if [ ! -f "$POLICY_FILE" ]; then
    echo -e "${RED}❌ Policy file not found: $POLICY_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Policy file found: $POLICY_FILE"
echo ""

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓${NC} AWS Account ID: $AWS_ACCOUNT_ID"

# Check if policy exists
POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${POLICY_NAME}"
echo ""
echo -e "${YELLOW}🔍 Checking if policy exists...${NC}"

if aws iam get-policy --policy-arn "$POLICY_ARN" &>/dev/null; then
    echo -e "${GREEN}✓${NC} Policy exists: $POLICY_NAME"
    
    # Get current default version
    CURRENT_VERSION=$(aws iam get-policy --policy-arn "$POLICY_ARN" --query 'Policy.DefaultVersionId' --output text)
    echo -e "${GREEN}✓${NC} Current version: $CURRENT_VERSION"
    
    # List all versions
    VERSION_COUNT=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query 'length(Versions)' --output text)
    echo -e "${BLUE}ℹ${NC}  Total versions: $VERSION_COUNT/5"
    
    # If we have 5 versions, delete the oldest non-default version
    if [ "$VERSION_COUNT" -eq 5 ]; then
        echo -e "${YELLOW}⚠${NC}  Maximum versions reached, deleting oldest..."
        OLDEST_VERSION=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query 'Versions[-1].VersionId' --output text)
        if [ "$OLDEST_VERSION" != "$CURRENT_VERSION" ]; then
            aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$OLDEST_VERSION"
            echo -e "${GREEN}✓${NC} Deleted version: $OLDEST_VERSION"
        fi
    fi
    
    # Create new policy version
    echo ""
    echo -e "${YELLOW}📝 Creating new policy version...${NC}"
    NEW_VERSION=$(aws iam create-policy-version \
        --policy-arn "$POLICY_ARN" \
        --policy-document file://$POLICY_FILE \
        --set-as-default \
        --query 'PolicyVersion.VersionId' \
        --output text)
    
    echo -e "${GREEN}✓${NC} New policy version created: $NEW_VERSION"
    echo -e "${GREEN}✓${NC} Set as default version"
    
else
    echo -e "${YELLOW}⚠${NC}  Policy does not exist, creating..."
    
    # Create new policy
    aws iam create-policy \
        --policy-name "$POLICY_NAME" \
        --policy-document file://$POLICY_FILE \
        --description "Wedding Photo Processor permissions - SQS, CloudWatch Logs, EC2" \
        --output text > /dev/null
    
    echo -e "${GREEN}✓${NC} Policy created: $POLICY_NAME"
fi

echo ""
echo -e "${YELLOW}🔍 Checking IAM role...${NC}"

# Check if role exists
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
    echo -e "${GREEN}✓${NC} Role exists: $ROLE_NAME"
    
    # Check if policy is attached
    ATTACHED=$(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --query "AttachedPolicies[?PolicyName=='$POLICY_NAME'].PolicyName" --output text)
    
    if [ -z "$ATTACHED" ]; then
        echo -e "${YELLOW}⚠${NC}  Policy not attached to role, attaching..."
        aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY_ARN"
        echo -e "${GREEN}✓${NC} Policy attached to role"
    else
        echo -e "${GREEN}✓${NC} Policy already attached to role"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Role does not exist, creating..."
    
    # Create trust policy for EC2
    cat > /tmp/trust-policy.json <<EOF
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
    
    # Create role
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file:///tmp/trust-policy.json \
        --description "Wedding Photo Processor EC2 role" \
        --output text > /dev/null
    
    echo -e "${GREEN}✓${NC} Role created: $ROLE_NAME"
    
    # Attach policy to role
    aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY_ARN"
    echo -e "${GREEN}✓${NC} Policy attached to role"
    
    # Clean up temp file
    rm /tmp/trust-policy.json
fi

echo ""
echo -e "${YELLOW}🔍 Checking instance profile...${NC}"

# Check if instance profile exists
if aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" &>/dev/null; then
    echo -e "${GREEN}✓${NC} Instance profile exists: $INSTANCE_PROFILE_NAME"
    
    # Check if role is attached to instance profile
    PROFILE_ROLE=$(aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" --query 'InstanceProfile.Roles[0].RoleName' --output text 2>/dev/null || echo "")
    
    if [ "$PROFILE_ROLE" != "$ROLE_NAME" ]; then
        echo -e "${YELLOW}⚠${NC}  Role not attached to instance profile, attaching..."
        # Remove old role if exists
        if [ ! -z "$PROFILE_ROLE" ] && [ "$PROFILE_ROLE" != "None" ]; then
            aws iam remove-role-from-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" --role-name "$PROFILE_ROLE"
        fi
        # Add new role
        aws iam add-role-to-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" --role-name "$ROLE_NAME"
        echo -e "${GREEN}✓${NC} Role attached to instance profile"
    else
        echo -e "${GREEN}✓${NC} Role already attached to instance profile"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Instance profile does not exist, creating..."
    
    # Create instance profile
    aws iam create-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" --output text > /dev/null
    echo -e "${GREEN}✓${NC} Instance profile created: $INSTANCE_PROFILE_NAME"
    
    # Attach role to instance profile
    aws iam add-role-to-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" --role-name "$ROLE_NAME"
    echo -e "${GREEN}✓${NC} Role attached to instance profile"
    
    # Wait for instance profile to propagate
    echo -e "${YELLOW}⏳ Waiting for instance profile to propagate (10 seconds)...${NC}"
    sleep 10
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ IAM Policy Update Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Policy Details:${NC}"
echo -e "  Policy Name: $POLICY_NAME"
echo -e "  Policy ARN: $POLICY_ARN"
echo -e "  Role Name: $ROLE_NAME"
echo -e "  Instance Profile: $INSTANCE_PROFILE_NAME"
echo ""
echo -e "${YELLOW}Permissions Granted:${NC}"
echo -e "  ✓ SQS: ReceiveMessage, DeleteMessage, GetQueueAttributes"
echo -e "  ✓ CloudWatch Logs: CreateLogGroup, CreateLogStream, PutLogEvents"
echo -e "  ✓ EC2: DescribeInstances, TerminateInstances"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo -e "  1. Launch a new EC2 instance with this instance profile"
echo -e "  2. Or update existing instances (requires restart)"
echo -e "  3. Test the complete flow"
echo ""
echo -e "${YELLOW}Launch New Instance:${NC}"
echo -e "  bash aws-ec2-spot/deploy-ec2-modern-streaming.sh"
echo ""
echo -e "${YELLOW}Check Running Instances:${NC}"
echo -e "  aws ec2 describe-instances --filters 'Name=tag:Name,Values=wedding-photo-processor' 'Name=instance-state-name,Values=running'"
echo ""
