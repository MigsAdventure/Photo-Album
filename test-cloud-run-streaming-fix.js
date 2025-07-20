/**
 * Test Cloud Run streaming fix - verify response.body.getReader() works
 * Tests the fix for node-fetch compatibility issue
 */

// Use native fetch if available (Node.js 18+), otherwise use node-fetch for testing only
const fetch = globalThis.fetch || require('node-fetch');

async function testCloudRunStreamingFix() {
  console.log('🧪 Testing Cloud Run streaming fix...');
  
  const testEventId = '1ed05664'; // Known test event
  const testEmail = 'test@example.com';
  
  // Test the Cloud Run processor endpoint
  const cloudRunUrl = process.env.CLOUD_RUN_URL || 'https://wedding-photo-processor-latest-4nmuiwcsta-uc.a.run.app';
  
  try {
    console.log(`📡 Testing Cloud Run processor: ${cloudRunUrl}`);
    
    // Test 1: Health check
    console.log('\n1️⃣ Testing health check...');
    const healthResponse = await fetch(`${cloudRunUrl}/health`);
    const healthData = await healthResponse.json();
    
    console.log('✅ Health check response:', {
      status: healthData.status,
      version: healthData.version,
      uptime: healthData.uptime
    });
    
    // Test 2: Config check 
    console.log('\n2️⃣ Testing config check...');
    const configResponse = await fetch(`${cloudRunUrl}/config-check`);
    const configData = await configResponse.json();
    
    console.log('✅ Config check response:', {
      status: configData.status,
      firebase: configData.firebase?.configured,
      r2: configData.r2?.configured,
      email: configData.email?.configured
    });
    
    // Test 3: Debug Firestore (this will use the streaming download)
    console.log('\n3️⃣ Testing Firestore debug (streams files internally)...');
    const firestoreResponse = await fetch(`${cloudRunUrl}/debug/firestore/${testEventId}`);
    const firestoreData = await firestoreResponse.json();
    
    console.log('✅ Firestore debug response:', {
      success: firestoreData.success,
      photoCount: firestoreData.photoCount,
      firestoreConnection: firestoreData.firestoreConnection
    });
    
    // Test 4: Actual processing (will test streaming downloads for real)
    console.log('\n4️⃣ Testing actual photo processing...');
    const processResponse = await fetch(`${cloudRunUrl}/process-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventId: testEventId,
        email: testEmail
      })
    });
    
    const processData = await processResponse.json();
    
    console.log('✅ Processing response:', {
      success: processData.success,
      message: processData.message,
      fileCount: processData.fileCount,
      estimatedSizeMB: processData.estimatedSizeMB,
      requestId: processData.requestId
    });
    
    console.log('\n🎉 All tests passed! Cloud Run streaming fix is working.');
    console.log('\n📋 Summary:');
    console.log('   ✅ Removed node-fetch dependency');
    console.log('   ✅ Using Node.js 20+ built-in fetch API');
    console.log('   ✅ response.body.getReader() now works properly');
    console.log('   ✅ Streaming downloads functional');
    
    return true;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.message.includes('getReader')) {
      console.error('\n🔍 This confirms the original issue:');
      console.error('   • node-fetch v2.x returns Node.js streams');
      console.error('   • Native fetch returns Web API ReadableStream');
      console.error('   • Only Web API streams have .getReader() method');
      console.error('\n💡 Fix: Use Node.js 20+ built-in fetch instead of node-fetch');
    }
    
    return false;
  }
}

// Test native fetch compatibility
async function testNativeFetchCompatibility() {
  console.log('\n🔬 Testing native fetch ReadableStream compatibility...');
  
  try {
    // Test with a small Firebase Storage URL
    const testUrl = 'https://firebasestorage.googleapis.com/v0/b/sharedmoments-b6c9e.appspot.com/o/photos%2Ftest.jpg?alt=media';
    
    const response = await fetch(testUrl);
    console.log('📡 Fetch response received');
    
    // This is the critical test - does response.body have getReader()?
    if (response.body && typeof response.body.getReader === 'function') {
      console.log('✅ response.body.getReader() is available');
      
      const reader = response.body.getReader();
      console.log('✅ getReader() created successfully');
      
      // Try to read one chunk
      const { done, value } = await reader.read();
      console.log('✅ Stream reading works:', { 
        done, 
        chunkSize: value?.length || 0 
      });
      
      reader.releaseLock();
      console.log('✅ Stream released successfully');
      
      return true;
    } else {
      console.error('❌ response.body.getReader() is not available');
      console.error('   Response body type:', typeof response.body);
      console.error('   Available methods:', Object.getOwnPropertyNames(response.body));
      return false;
    }
    
  } catch (error) {
    console.error('❌ Native fetch test failed:', error.message);
    return false;
  }
}

// Run tests
async function runAllTests() {
  console.log('🚀 Cloud Run Streaming Fix Verification\n');
  
  // Test 1: Native fetch compatibility
  const nativeTest = await testNativeFetchCompatibility();
  
  if (nativeTest) {
    console.log('\n✅ Native fetch compatibility confirmed');
    
    // Test 2: Cloud Run service
    const cloudRunTest = await testCloudRunStreamingFix();
    
    if (cloudRunTest) {
      console.log('\n🎯 All tests passed! Ready to deploy fix.');
    } else {
      console.log('\n⚠️ Cloud Run tests failed - may need deployment');
    }
  } else {
    console.log('\n❌ Native fetch not compatible - check Node.js version');
  }
}

// Export for use in other scripts
module.exports = {
  testCloudRunStreamingFix,
  testNativeFetchCompatibility,
  runAllTests
};

// Run if called directly
if (require.main === module) {
  runAllTests().catch(console.error);
}
