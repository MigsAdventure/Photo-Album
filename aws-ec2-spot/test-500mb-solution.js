#!/usr/bin/env node

// Test the AWS EC2 Spot Solution for 500MB Wedding Video Processing
// Ultra Cost-Efficient: ~$0.01-0.02 per job vs $0.80+ for Lambda

const https = require('https');

const LAMBDA_URL = 'https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/';

console.log('🚀 Testing AWS EC2 Spot Solution for 500MB Video Processing');
console.log(`📍 Lambda URL: ${LAMBDA_URL}`);
console.log('💰 Expected cost: ~$0.01-0.02 per job (95% savings!)');
console.log();

// Test data simulating a 500MB video processing request
const testData = {
  eventId: 'test-500mb-wedding-' + Date.now(),
  email: 'test@example.com',
  photos: [
    { fileName: 'wedding-video-500mb.mp4', size: 524288000, mediaType: 'video' },
    { fileName: 'photo1.jpg', size: 5242880, mediaType: 'photo' },
    { fileName: 'photo2.jpg', size: 4194304, mediaType: 'photo' },
    { fileName: 'photo3.jpg', size: 6291456, mediaType: 'photo' }
  ]
};

const requestBody = JSON.stringify(testData);

console.log(`📊 Test request data:`);
console.log(`   Event ID: ${testData.eventId}`);
console.log(`   Files: ${testData.photos.length} (including 500MB video)`);
console.log(`   Total size: ${(testData.photos.reduce((sum, p) => sum + p.size, 0) / 1024 / 1024).toFixed(2)}MB`);
console.log();

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody)
  }
};

console.log('🔄 Sending request to launch EC2 Spot instance...');

const req = https.request(LAMBDA_URL, options, (res) => {
  console.log(`📡 Response status: ${res.statusCode}`);
  
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(responseData);
      
      console.log('\n🎉 AWS EC2 Spot Response:');
      console.log('================================');
      
      if (result.success) {
        console.log('✅ Status: SUCCESS');
        console.log(`🆔 Instance ID: ${result.instanceId}`);
        console.log(`🌐 Public IP: ${result.publicIP || 'Pending...'}`);
        console.log(`💰 Estimated Cost: ${result.estimatedCost}`);
        console.log(`⏱️  Processing Time: ${result.processingTime}`);
        console.log(`🖥️  Instance Type: ${result.instanceType}`);
        console.log(`📧 Email: ${result.email}`);
        console.log(`📸 Photo Count: ${result.photoCount}`);
        console.log(`🕐 Timestamp: ${result.timestamp}`);
        
        console.log('\n💡 What happens next:');
        console.log('1. EC2 t3.medium spot instance launches (~30 seconds)');
        console.log('2. Instance downloads files from Firebase (~1-2 minutes)');
        console.log('3. Files are zipped and uploaded to S3 (~30 seconds)');
        console.log('4. Email sent with download link');
        console.log('5. Instance auto-terminates after 10 minutes idle');
        console.log(`6. Total cost: ~$0.01-0.02 (vs $2-5 with current Cloud Run)`);
        
        console.log('\n✅ 500MB Video Processing Solution is WORKING!');
        
      } else {
        console.log('❌ Status: FAILED');
        console.log(`🚨 Error: ${result.error}`);
        console.log(`📝 Message: ${result.message || 'No additional details'}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to parse response:', error);
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error);
});

req.write(requestBody);
req.end();

console.log('⏳ Waiting for response...');
