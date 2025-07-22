const { S3Client, GetBucketPolicyCommand } = require('@aws-sdk/client-s3');

// Initialize S3 client
const s3Client = new S3Client({ region: 'us-east-1' });

async function checkS3BucketPolicy() {
  try {
    const bucketName = 'wedding-photo-spot-1752995104';
    
    console.log(`Checking S3 bucket policy for: ${bucketName}`);
    
    const command = new GetBucketPolicyCommand({
      Bucket: bucketName
    });
    
    const response = await s3Client.send(command);
    
    if (response.Policy) {
      const policy = JSON.parse(response.Policy);
      console.log('Bucket policy:');
      console.log(JSON.stringify(policy, null, 2));
      
      // Check if the policy allows public access
      const statements = policy.Statement || [];
      const publicAccess = statements.some(statement => 
        statement.Effect === 'Allow' && 
        (statement.Principal === '*' || statement.Principal?.AWS === '*')
      );
      
      console.log(`\nPublic access allowed: ${publicAccess ? 'Yes' : 'No'}`);
      
    } else {
      console.log('No bucket policy found');
    }
  } catch (error) {
    console.error('Error checking S3 bucket policy:', error);
  }
}

checkS3BucketPolicy();