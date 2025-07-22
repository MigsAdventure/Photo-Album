const { S3Client, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

// Initialize S3 client
const s3Client = new S3Client({ region: 'us-east-1' });

async function updateS3BucketPolicy() {
  try {
    const bucketName = 'wedding-photo-spot-1752995104';
    
    console.log(`Updating S3 bucket policy for: ${bucketName}`);
    
    // Define the updated policy
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadForGetBucketObjects',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: [
            `arn:aws:s3:::${bucketName}/wedding-photos/*`,
            `arn:aws:s3:::${bucketName}/downloads/*`
          ]
        }
      ]
    };
    
    const command = new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(policy)
    });
    
    await s3Client.send(command);
    
    console.log('✅ Bucket policy updated successfully');
    console.log('Updated policy:');
    console.log(JSON.stringify(policy, null, 2));
    
  } catch (error) {
    console.error('Error updating S3 bucket policy:', error);
  }
}

updateS3BucketPolicy();