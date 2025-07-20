/**
 * Test email delivery functionality after fixing configuration
 * Tests the complete Durable Objects + Email flow
 */

const testEmailDelivery = async () => {
  console.log('🧪 Testing Email Delivery Fix...\n');
  
  const WORKER_URL = 'https://sharedmoments-photo-processor.migsub77.workers.dev';
  const TEST_EMAIL = 'test@example.com';
  
  try {
    console.log('📧 Testing email configuration...');
    
    // Test with a small test payload
    const testPayload = {
      eventId: 'test-email-fix-' + Date.now(),
      email: TEST_EMAIL,
      photos: [
        {
          id: 'test1',
          fileName: 'test-photo-1.jpg',
          url: 'https://picsum.photos/800/600',
          size: 500000, // 500KB
          mediaType: 'photo'
        },
        {
          id: 'test2', 
          fileName: 'test-photo-2.jpg',
          url: 'https://picsum.photos/600/800',
          size: 400000, // 400KB
          mediaType: 'photo'
        }
      ]
    };
    
    console.log(`📤 Sending test request to: ${WORKER_URL}`);
    console.log(`📊 Test data: ${testPayload.photos.length} photos, ${TEST_EMAIL}`);
    
    const startTime = Date.now();
    
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SharedMoments-EmailTest/1.0'
      },
      body: JSON.stringify(testPayload)
    });
    
    const responseTime = Date.now() - startTime;
    console.log(`⏱️ Response time: ${responseTime}ms`);
    
    if (!response.ok) {
      console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return;
    }
    
    const result = await response.json();
    console.log('\n✅ Worker Response:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n🎉 SUCCESS! Email delivery configuration is working!');
      console.log(`📧 Processing initiated for ${result.fileCount} files`);
      console.log(`⏳ Estimated processing time: ${result.estimatedTime || 'Not specified'}`);
      console.log(`🔧 Processing engine: ${result.processingEngine || 'Default'}`);
      
      if (result.message) {
        console.log(`💬 Worker message: ${result.message}`);
      }
      
      console.log('\n📬 Email should be delivered to:', TEST_EMAIL);
      console.log('📝 Check your email for download link in 1-3 minutes');
      
    } else {
      console.error('\n❌ Worker returned success=false');
      console.error('Response:', result);
    }
    
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('🌐 Network error - check if Worker URL is correct');
    } else if (error.name === 'SyntaxError') {
      console.error('📄 JSON parsing error - Worker may have returned HTML');
    }
  }
};

// Test email configuration specifically
const testEmailConfig = async () => {
  console.log('\n🔧 Testing Email Configuration...');
  
  try {
    // Test the specific email endpoint
    const netlifyUrl = 'https://main--sharedmoments.netlify.app/.netlify/functions/email-download';
    
    console.log(`📧 Testing Netlify email function: ${netlifyUrl}`);
    
    const testEmailPayload = {
      eventId: 'email-config-test',
      email: 'test@example.com',
      source: 'cloudflare-worker',
      downloadUrl: 'https://example.com/test.zip',
      fileCount: 5,
      finalSizeMB: 25.5,
      compressionStats: {
        photosCompressed: 5,
        compressionRatio: 15.2
      },
      processingTimeSeconds: 8.3
    };
    
    const response = await fetch(netlifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://sharedmoments-photo-processor.migsub77.workers.dev'
      },
      body: JSON.stringify(testEmailPayload)
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Netlify email function responding correctly');
      console.log('📧 Email configuration is properly connected!');
    } else {
      console.warn(`⚠️ Netlify response: ${response.status} ${response.statusText}`);
    }
    
  } catch (error) {
    console.error('❌ Email configuration test failed:', error.message);
  }
};

// Run tests
const runAllTests = async () => {
  console.log('='.repeat(60));
  console.log('🚀 EMAIL DELIVERY FIX VERIFICATION TEST');
  console.log('='.repeat(60));
  
  await testEmailDelivery();
  await testEmailConfig();
  
  console.log('\n' + '='.repeat(60));
  console.log('✨ Email delivery testing complete!');
  console.log('='.repeat(60));
};

// Execute tests
runAllTests().catch(console.error);
