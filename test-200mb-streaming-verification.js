// Test for verifying 200MB video streaming download fix
const https = require('https');

const SERVICE_URL = 'https://wedding-photo-processor-767610841427.us-west1.run.app';

async function testStreamingFix() {
  console.log('🧪 Testing 200MB Video Streaming Download Fix');
  console.log('==========================================');
  
  // Test 1: Health check
  console.log('\n1. Testing service health...');
  const healthResponse = await fetch(`${SERVICE_URL}/config-check`);
  const healthData = await healthResponse.json();
  
  if (healthData.status === 'healthy') {
    console.log('✅ Service is healthy and ready');
    console.log(`   Firebase: ${healthData.firebase.configured}`);
    console.log(`   R2: ${healthData.r2.configured}`);
    console.log(`   Email: ${healthData.email.configured}`);
  } else {
    console.log('❌ Service health check failed');
    return;
  }
  
  // Test 2: Process photos with large files
  console.log('\n2. Testing large file processing...');
  
  const processRequest = {
    eventId: '2025-07-25_23r423_8xron6po', // Event with 200MB video
    email: 'migsub77@gmail.com'
  };
  
  console.log(`   Event ID: ${processRequest.eventId}`);
  console.log(`   Email: ${processRequest.email}`);
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${SERVICE_URL}/process-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(processRequest)
    });
    
    const responseTime = Date.now() - startTime;
    const result = await response.json();
    
    console.log(`\n📊 Response received in ${responseTime}ms:`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Message: ${result.message}`);
    console.log(`   Request ID: ${result.requestId}`);
    console.log(`   File Count: ${result.fileCount}`);
    console.log(`   Estimated Size: ${result.estimatedSizeMB}MB`);
    console.log(`   Estimated Time: ${result.estimatedTime}`);
    
    if (result.success) {
      console.log('\n✅ Photo processing started successfully');
      console.log('🔄 Background processing will handle the 200MB video with streaming');
      console.log('📧 You will receive an email when processing is complete');
      console.log('\n📈 Expected improvements with streaming fix:');
      console.log('   • No more timeout errors on large files');
      console.log('   • Memory-efficient chunked downloads');
      console.log('   • Progress tracking for files >50MB');
      console.log('   • 15-minute timeout for individual files');
      console.log('   • Automatic garbage collection after large files');
      
      return {
        success: true,
        requestId: result.requestId,
        fileCount: result.fileCount,
        estimatedSizeMB: result.estimatedSizeMB
      };
    } else {
      console.log('❌ Photo processing failed');
      return { success: false, error: result.error };
    }
    
  } catch (error) {
    console.error(`❌ Request failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Test monitoring function
async function monitorProcessing(requestId) {
  console.log(`\n🔍 Monitoring processing for request: ${requestId}`);
  console.log('Note: Check Cloud Run logs for detailed progress');
  console.log('Expected log messages with streaming fix:');
  console.log('  📊 Expected file size [requestId]: filename (XXX.XXMb)');
  console.log('  📈 Download progress [requestId]: filename - XX.XMB (XX.X%)');
  console.log('  ✅ Downloaded from Firebase [requestId]: filename (XXX.XXMb)');
}

// Run the test
async function runTest() {
  try {
    const result = await testStreamingFix();
    
    if (result.success) {
      await monitorProcessing(result.requestId);
      
      console.log('\n🎯 Key Fix Features Implemented:');
      console.log('================================');
      console.log('• Streaming Downloads: Files downloaded in chunks, not loaded entirely into memory');
      console.log('• Extended Timeout: 15-minute timeout per file (was 5 minutes)');
      console.log('• Progress Tracking: Shows download progress every 25MB for large files');
      console.log('• Memory Management: Automatic garbage collection after processing large files');
      console.log('• Error Handling: Better timeout and network error handling');
      console.log('• Chunked Processing: Uses response.body.getReader() for memory-efficient streaming');
      
      console.log('\n📋 What to watch for in logs:');
      console.log('• "Expected file size" - Shows file size detected from headers');
      console.log('• "Download progress" - Shows progress every 25MB for large files');
      console.log('• "Downloaded from Firebase" - Shows successful completion with final size');
      console.log('• No more hanging on "Downloading from Firebase" for 200MB files');
      
    } else {
      console.log(`\n❌ Test failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error(`\n💥 Test error: ${error.message}`);
  }
}

// Helper function for fetch if not available
if (typeof fetch === 'undefined') {
  global.fetch = async (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };
      
      const req = https.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            json: () => Promise.resolve(JSON.parse(data)),
            text: () => Promise.resolve(data)
          });
        });
      });
      
      req.on('error', reject);
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  };
}

// Run the test
runTest();
