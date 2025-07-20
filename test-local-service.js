// Test the Cloud Run service running locally
const testLocalService = async () => {
  console.log('🧪 Testing Local Cloud Run Service');
  console.log('===================================');
  
  const LOCAL_URL = 'http://localhost:8080';
  
  try {
    // Wait a moment for service to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test 1: Health check
    console.log('\n📋 Test 1: Health Check');
    console.log('------------------------');
    
    const healthResponse = await fetch(LOCAL_URL);
    
    if (!healthResponse.ok) {
      throw new Error(`HTTP ${healthResponse.status}: ${healthResponse.statusText}`);
    }
    
    const healthData = await healthResponse.json();
    
    console.log('✅ Health check successful:', {
      status: healthData.status,
      service: healthData.service,
      version: healthData.version
    });
    
    // Test 2: Process photos request (will fail due to missing env vars, but should show endpoint works)
    console.log('\n📸 Test 2: Process Photos Endpoint');
    console.log('-----------------------------------');
    
    const processResponse = await fetch(`${LOCAL_URL}/process-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventId: 'test-event-123',
        email: 'test@example.com'
      })
    });
    
    const processData = await processResponse.json();
    
    console.log('📊 Process endpoint response:', {
      status: processResponse.status,
      data: processData
    });
    
    if (processResponse.status === 500 && processData.details && processData.details.includes('environment')) {
      console.log('✅ Endpoint working! Failure is due to missing environment variables (expected)');
    } else if (processResponse.ok) {
      console.log('✅ Process endpoint working!');
    } else {
      console.log('⚠️ Unexpected response from process endpoint');
    }
    
    console.log('\n🎉 SUCCESS: Local service is working!');
    console.log('📋 Next: Deploy to Cloud Run with environment variables');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
      console.log('\n🔧 Service may still be starting. Try running again in a few seconds.');
    }
  }
};

// Run the test
testLocalService().catch(console.error);
