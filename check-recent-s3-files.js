const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// Initialize S3 client
const s3Client = new S3Client({ region: 'us-east-1' });

async function checkRecentS3Files() {
  try {
    const bucketName = 'wedding-photo-spot-1752995104';
    
    console.log(`Checking S3 bucket for recent files: ${bucketName}`);
    
    // Check both prefixes
    const prefixes = ['wedding-photos/', 'downloads/'];
    
    for (const prefix of prefixes) {
      console.log(`\nChecking prefix: ${prefix}`);
      
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 20
      });
      
      const response = await s3Client.send(command);
      
      if (response.Contents && response.Contents.length > 0) {
        // Sort by last modified date (newest first)
        const sortedFiles = response.Contents.sort((a, b) => 
          b.LastModified.getTime() - a.LastModified.getTime()
        );
        
        console.log(`Found ${sortedFiles.length} files:`);
        
        sortedFiles.forEach(file => {
          const lastModified = file.LastModified.toISOString();
          const fileSizeMB = (file.Size / 1024 / 1024).toFixed(2);
          console.log(`- ${file.Key} (${fileSizeMB}MB, Last modified: ${lastModified})`);
        });
        
        // Check if any files were created in the last hour
        const oneHourAgo = new Date();
        oneHourAgo.setHours(oneHourAgo.getHours() - 1);
        
        const recentFiles = sortedFiles.filter(file => 
          file.LastModified > oneHourAgo
        );
        
        if (recentFiles.length > 0) {
          console.log(`\n${recentFiles.length} files were created in the last hour:`);
          recentFiles.forEach(file => {
            const lastModified = file.LastModified.toISOString();
            const fileSizeMB = (file.Size / 1024 / 1024).toFixed(2);
            console.log(`- ${file.Key} (${fileSizeMB}MB, Last modified: ${lastModified})`);
            console.log(`  URL: https://${bucketName}.s3.amazonaws.com/${file.Key}`);
          });
        } else {
          console.log('\nNo files were created in the last hour');
        }
      } else {
        console.log('No files found with this prefix');
      }
    }
  } catch (error) {
    console.error('Error checking S3 files:', error);
  }
}

checkRecentS3Files();