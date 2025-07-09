/**
 * Test script for event-created-notification function
 * Tests the new email notification system for event creation
 */

const https = require('https');

// Test configuration
const NETLIFY_FUNCTION_URL = process.env.NETLIFY_FUNCTION_URL || 'https://sharedmoments.socialboostai.com/.netlify/functions/event-created-notification';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';

// Test data
const testEventData = {
  eventId: 'test-' + Date.now(),
  eventTitle: 'Test Wedding Celebration',
  eventDate: '2024-08-15',
  email: TEST_EMAIL,
  eventUrl: 'https://sharedmoments.socialboostai.com/event/test-' + Date.now()
};

console.log('🧪 Testing Event Creation Email Notification Function');
console.log('=====================================');
console.log('📧 Test Email:', testEventData.email);
console.log('🎉 Test Event:', testEventData.eventTitle);
console.log('📅 Test Date:', testEventData.eventDate);
console.log('🔗 Test URL:', testEventData.eventUrl);
console.log('⚡ Function URL:', NETLIFY_FUNCTION_URL);
console.log('=====================================\n');

// Prepare request data
const postData = JSON.stringify(testEventData);
const url = new URL(NETLIFY_FUNCTION_URL);

const options = {
  hostname: url.hostname,
  port: 443,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('📤 Sending test request...');

const req = https.request(options, (res) => {
  console.log(`📊 Response Status: ${res.statusCode}`);
  console.log(`📋 Response Headers:`, res.headers);
  
  let responseBody = '';
  
  res.on('data', (chunk) => {
    responseBody += chunk;
  });
  
  res.on('end', () => {
    console.log('\n📥 Response Body:');
    console.log('=====================================');
    
    try {
      const parsedResponse = JSON.parse(responseBody);
      console.log(JSON.stringify(parsedResponse, null, 2));
      
      if (res.statusCode === 200) {
        console.log('\n✅ SUCCESS! Event creation email test passed!');
        console.log(`📧 Email should be sent to: ${testEventData.email}`);
        console.log(`🎯 Check the inbox for event details and QR code`);
        
        if (parsedResponse.requestId) {
          console.log(`🔍 Request ID: ${parsedResponse.requestId}`);
        }
      } else {
        console.log(`\n❌ FAILED! Status Code: ${res.statusCode}`);
        console.log(`💬 Error: ${parsedResponse.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.log('Raw response (not JSON):');
      console.log(responseBody);
      console.log(`\n❌ FAILED! Could not parse response: ${error.message}`);
    }
    
    console.log('=====================================');
  });
});

req.on('error', (error) => {
  console.log(`\n❌ REQUEST FAILED: ${error.message}`);
  console.log('💡 Make sure the Netlify function is deployed and accessible');
  
  if (error.code === 'ENOTFOUND') {
    console.log('🌐 DNS resolution failed - check the function URL');
  } else if (error.code === 'ECONNREFUSED') {
    console.log('🔌 Connection refused - function may not be running');
  }
});

req.write(postData);
req.end();

console.log('⏳ Waiting for response...\n');

// Additional usage information
setTimeout(() => {
  console.log('\n💡 Usage Notes:');
  console.log('=====================================');
  console.log('• Set TEST_EMAIL environment variable for real email testing');
  console.log('• Set NETLIFY_FUNCTION_URL for local testing');
  console.log('• Check Netlify function logs for detailed debugging');
  console.log('• Verify EMAIL_USER and EMAIL_PASSWORD are set in Netlify');
  console.log('• QR code should be embedded in the email as base64 image');
  console.log('=====================================');
}, 100);
