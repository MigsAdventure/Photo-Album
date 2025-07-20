// Test the new simplified Cloud Run processor
// This replaces all the complex Netlify/Cloudflare/Google Cloud routing

const testCloudRunProcessor = async () => {
  console.log('🧪 Testing Simple Cloud Run Photo Processor');
  console.log('===========================================');
  
  // Test configuration - update with your actual Cloud Run URL after deployment
  const CLOUD_RUN_URL = 'https://wedding-photo-processor-YOUR-HASH-uw.a.run.app';
  const TEST_EVENT_ID = 'test-event-123';
  const TEST_EMAIL = 'test@example.com';
  
  try {
    // Test 1: Health check
    console.log('\n📋 Test 1: Health Check');
    console.log('------------------------');
    
    const healthResponse = await fetch(CLOUD_RUN_URL);
    const healthData = await healthResponse.json();
    
    console.log('✅ Health check response:', {
      status: healthData.status,
      service: healthData.service,
      version: healthData.version
    });
    
    // Test 2: Process photos request
    console.log('\n📸 Test 2: Process Photos Request');
    console.log('----------------------------------');
    
    const processResponse = await fetch(`${CLOUD_RUN_URL}/process-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventId: TEST_EVENT_ID,
        email: TEST_EMAIL
      })
    });
    
    const processData = await processResponse.json();
    
    if (processResponse.ok) {
      console.log('✅ Process request successful:', {
        message: processData.message,
        requestId: processData.requestId,
        fileCount: processData.fileCount,
        estimatedTime: processData.estimatedTime
      });
      
      console.log('\n🎉 SUCCESS: Cloud Run processor is working!');
      console.log('📧 Check the test email for download link');
      
    } else {
      console.log('⚠️ Process request returned error:', processData);
      
      if (processData.error === 'No photos found for this event') {
        console.log('ℹ️ This is expected if the test event has no photos');
        console.log('✅ The service is working correctly');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.message.includes('fetch')) {
      console.log('\n🔧 Troubleshooting:');
      console.log('1. Make sure you\'ve deployed the Cloud Run service');
      console.log('2. Update CLOUD_RUN_URL in this test file');
      console.log('3. Check that the service is accessible');
    }
  }
  
  console.log('\n📋 Next Steps:');
  console.log('1. Deploy the service: cd cloud-run-processor && ./deploy.sh');
  console.log('2. Set environment variables in Cloud Run Console');
  console.log('3. Update your frontend to use the new service URL');
  console.log('4. Remove the complex Netlify/Cloudflare routing');
};

// Run the test
testCloudRunProcessor().catch(console.error);
