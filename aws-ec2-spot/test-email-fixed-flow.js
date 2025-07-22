const https = require('https');

const lambdaUrl = 'https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/';

// Test payload with your actual email
const testPayload = {
  eventId: '2025-07-21_test_email_' + Date.now(),
  email: 'migsub77@gmail.com',
  photos: [
    {
      fileName: 'test-photo-1.jpg',
      url: 'https://firebasestorage.googleapis.com/v0/b/wedding-photo-240c9.firebasestorage.app/o/photos%2F2025-07-30_hdhdh_5stq7dgh%2Fresized_IMG_7149.jpg?alt=media&token=1290f2e2-4ac7-4e90-b30f-f83ee80dd033',
      size: 25 * 1024 * 1024 // 25MB
    },
    {
      fileName: 'test-photo-2.jpg',
      url: 'https://firebasestorage.googleapis.com/v0/b/wedding-photo-240c9.firebasestorage.app/o/photos%2F2025-07-30_hdhdh_5stq7dgh%2Fresized_IMG_7150.jpg?alt=media&token=e93d2a09-13b8-4d45-b7d4-e7b5f92e7bc8',
      size: 30 * 1024 * 1024 // 30MB
    }
  ],
  requestId: 'test-email-fix-' + Date.now(),
  timestamp: Date.now(),
  source: 'test-script'
};

console.log('🚀 Testing EC2 email flow with fixed endpoint...');
console.log(`📧 Email will be sent to: ${testPayload.email}`);
console.log(`📦 Processing ${testPayload.photos.length} files`);

const data = JSON.stringify(testPayload);

const url = new URL(lambdaUrl);
const options = {
  hostname: url.hostname,
  port: 443,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log(`\n📡 Response Status: ${res.statusCode}`);
    console.log('📥 Response:', responseData);
    
    try {
      const parsed = JSON.parse(responseData);
      if (parsed.success) {
        console.log('\n✅ SUCCESS! EC2 instance launched');
        console.log(`📋 Job ID: ${parsed.jobId}`);
        console.log(`🖥️ Instance ID: ${parsed.instanceId}`);
        console.log('\n⏳ Next steps:');
        console.log('1. EC2 instance will process the files (~2-3 minutes)');
        console.log('2. Files will be zipped and uploaded to R2');
        console.log('3. Email will be sent to:', testPayload.email);
        console.log('\n💡 Monitor the processing:');
        console.log(`   aws sqs receive-message --queue-url https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue --max-number-of-messages 10 --visibility-timeout 0 --region us-east-1`);
      } else {
        console.error('❌ FAILED:', parsed.error || 'Unknown error');
      }
    } catch (e) {
      console.error('❌ Failed to parse response:', e.message);
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error);
});

req.write(data);
req.end();
