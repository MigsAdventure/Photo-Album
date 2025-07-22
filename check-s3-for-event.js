const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// Initialize S3 client
const s3Client = new S3Client({ region: 'us-east-1' });

async function checkS3ForEvent(eventId) {
  try {
    const bucketName = 'wedding-photo-spot-1752995104';
    const prefixes = [
      `wedding-photos/${eventId}/`,
      `downloads/event_${eventId}_`
    ];
    
    console.log(`Checking S3 bucket: ${bucketName} for event ID: ${eventId}`);
    
    for (const prefix of prefixes) {
      console.log(`\nChecking prefix: ${prefix}`);
      
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 10
      });
      
      const response = await s3Client.send(command);
      
      if (response.Contents && response.Contents.length > 0) {
        console.log(`Found ${response.Contents.length} files:`);
        
        response.Contents.forEach(file => {
          console.log(`- ${file.Key} (${(file.Size/1024/1024).toFixed(2)}MB, Last modified: ${file.LastModified})`);
        });
        
        // Get the most recent file
        const mostRecentFile = response.Contents.sort((a, b) => b.LastModified - a.LastModified)[0];
        console.log(`\nMost recent file: ${mostRecentFile.Key}`);
        console.log(`Download URL: https://${bucketName}.s3.amazonaws.com/${mostRecentFile.Key}`);
      } else {
        console.log('No files found with this prefix');
      }
    }
  } catch (error) {
    console.error('Error checking S3 files:', error);
  }
}

// Check for the specific event ID
const eventId = '2025-07-25_23r423_8xron6po';
checkS3ForEvent(eventId);