const fetch = require('node-fetch');

async function testFixedFlow() {
  console.log('🧪 Testing Fixed EC2 Flow with R2 Upload...\n');

  const testData = {
    eventId: `2025-07-21_test_${Date.now()}`,
    email: 'migsub77@gmail.com',
    photos: [
      {
        fileName: 'test-photo-1.jpg',
        url: 'https://firebasestorage.googleapis.com/v0/b/wedding-photo-240c9.firebasestorage.app/o/photos%2F2025-07-21_test_1737377351065%2Fresized_IMG_7149.jpg?alt=media&token=39a1c7f3-8db5-4733-9eac-ad78e95c4ec1'
      },
      {
        fileName: 'test-photo-2.jpg',
        url: 'https://firebasestorage.googleapis.com/v0/b/wedding-photo-240c9.firebasestorage.app/o/photos%2F2025-07-21_test_1737377351065%2Fresized_IMG_7150.jpg?alt=media&token=ab2f9fc9-c7bb-4ed6-9d77-ae017be60ffd'
      }
    ],
    requestId: `test-${Date.now()}`
  };

  console.log('📊 Test Event Details:');
  console.log(`  - Event ID: ${testData.eventId}`);
  console.log(`  - Email: ${testData.email}`);
  console.log(`  - Photos: ${testData.photos.length}`);
  console.log(`  - Request ID: ${testData.requestId}\n`);

  try {
    // Call Lambda function URL
    console.log('📡 Calling Lambda function URL...');
    const lambdaUrl = 'https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/';
    
    const response = await fetch(lambdaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });

    const result = await response.json();
    console.log('\n📥 Lambda Response:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ Job queued successfully!');
      console.log(`🖥️  Instance: ${result.instanceId}`);
      console.log(`🌐 IP: ${result.publicIP || 'Starting...'}`);
      console.log(`♻️  Reused Instance: ${result.reusedInstance ? 'Yes' : 'No'}`);
      console.log(`💰 Estimated Cost: ${result.estimatedCost}`);
      console.log(`⏱️  Processing Time: ${result.processingTime}`);
      
      console.log('\n📧 You should receive an email at migsub77@gmail.com when processing completes.');
      console.log('\n📝 What happens next:');
      console.log('1. EC2 instance polls SQS queue and finds the job');
      console.log('2. Downloads photos from Firebase');
      console.log('3. Creates ZIP archive');
      console.log('4. Uploads to R2 storage (sharedmoments-photos-production)');
      console.log('5. Sends email with download link via Netlify function');
      
      if (result.publicIP) {
        console.log(`\n🔍 Monitor progress (if needed): http://${result.publicIP}:8080/health`);
      }
    } else {
      console.error('\n❌ Error:', result.error);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error.message);
  }
}

// Run the test
testFixedFlow().catch(console.error);
