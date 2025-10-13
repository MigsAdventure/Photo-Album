// Quick test to verify Cloud Run can receive and process requests
const https = require('https');

async function testCloudRunConnection() {
  const CLOUD_RUN_URL = 'https://wedding-photo-processor-767610841427.us-west1.run.app';
  
  console.log('🧪 Testing Cloud Run connection...\n');
  
  // Test 1: Health check
  console.log('Test 1: Health Check');
  try {
    const response = await fetch(CLOUD_RUN_URL);
    const data = await response.json();
    console.log('✅ Health check passed:', data);
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
  }
  
  console.log('\n---\n');
  
  // Test 2: Process endpoint (with minimal test data)
  console.log('Test 2: Process Endpoint Test');
  try {
    const testPayload = {
      eventId: 'test-event-123',
      email: 'test@example.com',
      photos: [
        {
          id: 'test1',
          fileName: 'test.jpg',
          url: 'https://example.com/test.jpg',
          size: 1024,
          sizeMB: 0.001,
          mediaType: 'photo'
        }
      ],
      source: 'manual-test',
      routingReason: 'Connection test'
    };
    
    console.log('Sending test payload to /process-photos...');
    const response = await fetch(`${CLOUD_RUN_URL}/process-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SharedMoments/Test',
      },
      body: JSON.stringify(testPayload),
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('Response body:', responseText);
    
    if (response.ok) {
      console.log('\n✅ Cloud Run is accepting requests');
      try {
        const data = JSON.parse(responseText);
        console.log('Parsed response:', data);
      } catch (e) {
        // Not JSON, that's ok
      }
    } else {
      console.log('\n⚠️ Cloud Run responded with error status');
    }
    
  } catch (error) {
    console.log('❌ Process endpoint test failed:', error.message);
    console.log('Error details:', error);
  }
}

testCloudRunConnection().catch(console.error);
