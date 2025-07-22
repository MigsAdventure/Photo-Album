const fetch = require('node-fetch');

async function testEmailFlow() {
  console.log('🧪 Testing Complete Email Flow with Real Email Address\n');
  
  const testData = {
    eventId: `email-test-${Date.now()}`,
    email: 'migsub77@gmail.com', // Using your real email
    photos: [
      {
        fileName: 'test-image-1.jpg',
        url: 'https://picsum.photos/800/600',
        size: 1048576, // 1MB
        mediaType: 'photo'
      },
      {
        fileName: 'test-image-2.jpg', 
        url: 'https://picsum.photos/1024/768',
        size: 2097152, // 2MB
        mediaType: 'photo'
      },
      {
        fileName: 'test-video.mp4',
        url: 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4',
        size: 104857600, // 100MB - should trigger AWS routing
        mediaType: 'video'
      }
    ],
    requestId: `email-flow-test-${Date.now()}`
  };

  console.log('📊 Test Data:');
  console.log(`   Event ID: ${testData.eventId}`);
  console.log(`   Email: ${testData.email}`);
  console.log(`   Files: ${testData.photos.length}`);
  console.log(`   Total Size: ~103MB (should trigger AWS processing)`);
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
    
    if (result.status === 'accepted' || result.message?.includes('AWS EC2 Spot')) {
      console.log('\n✅ SUCCESS: Request accepted for AWS processing');
      console.log('\n📧 Next Steps:');
      console.log('1. AWS Lambda will launch EC2 instance with proper IAM role');
      console.log('2. EC2 will process the files from the queue');
      console.log('3. EC2 will create a ZIP and upload to R2');
      console.log('4. EC2 will send email to: ' + testData.email);
      console.log('5. Check your email inbox in 2-3 minutes');
      console.log('\n⏱️  Estimated completion time: 2-3 minutes');
    } else {
      console.log('\n❌ Unexpected response - check the details above');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testEmailFlow();
