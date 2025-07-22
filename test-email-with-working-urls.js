const fetch = require('node-fetch');

async function testEmailFlow() {
  console.log('🧪 Testing Email Flow with Working URLs\n');
  
  const testData = {
    eventId: `working-test-${Date.now()}`,
    email: 'migsub77@gmail.com',
    photos: [
      {
        fileName: 'test-image-1.jpg',
        url: 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800',
        size: 1048576, // 1MB
        mediaType: 'photo'
      },
      {
        fileName: 'test-image-2.jpg', 
        url: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800',
        size: 2097152, // 2MB
        mediaType: 'photo'
      },
      {
        fileName: 'test-image-3.jpg',
        url: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=800',
        size: 104857600, // 100MB - trigger AWS but with valid image URL
        mediaType: 'photo'
      }
    ],
    requestId: `working-test-${Date.now()}`
  };

  console.log('📊 Test Data:');
  console.log(`   Event ID: ${testData.eventId}`);
  console.log(`   Email: ${testData.email}`);
  console.log(`   Files: ${testData.photos.length} (all with valid URLs)`);
  console.log(`   Total Size: ~103MB (triggers AWS processing)`);
  console.log('');

  try {
    console.log('📡 Sending request to Cloudflare Worker...');
    const response = await fetch('https://sharedmoments-photo-processor.migsub77.workers.dev/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });

    const result = await response.json();
    
    console.log('\n🎯 Response:', JSON.stringify(result, null, 2));
    
    if (result.processing === 'aws-ec2-spot') {
      console.log('\n✅ SUCCESS: Request routed to AWS EC2 Spot');
      console.log('\n📧 Email Flow:');
      console.log('1. EC2 downloads images from Unsplash (working URLs)');
      console.log('2. Creates ZIP archive of all photos');
      console.log('3. Uploads ZIP to R2 storage');
      console.log('4. Sends email with download link to: ' + testData.email);
      console.log('\n⏱️  Check your email in 1-2 minutes!');
    } else {
      console.log('\n❌ Unexpected response - check details above');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testEmailFlow();
