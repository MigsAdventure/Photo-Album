/**
 * Test Google Cloud Function with large files
 * Simulates 500MB+ video processing request
 */

const fetch = require('node-fetch');

// Test configuration
const TEST_CONFIG = {
  // Update this URL after deploying your Google Cloud Function
  functionUrl: 'https://your-region-your-project.cloudfunctions.net/processWeddingPhotos',
  
  // Test data simulating large wedding collection
  testPayload: {
    eventId: 'test_large_video_event',
    email: 'test@example.com',
    requestId: `test_large_${Date.now()}`,
    source: 'test-script',
    photos: [
      // Simulate 500MB video
      {
        fileName: 'wedding_ceremony_4k.mp4',
        url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_30mb.mp4', // Will use for test
        size: 500 * 1024 * 1024, // 500MB
        contentType: 'video/mp4'
      },
      // Simulate 200MB video
      {
        fileName: 'reception_highlights.mov',
        url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_720x480_20mb.mp4',
        size: 200 * 1024 * 1024, // 200MB
        contentType: 'video/quicktime'
      },
      // Some photos
      {
        fileName: 'bride_portrait.jpg',
        url: 'https://picsum.photos/4000/3000',
        size: 8 * 1024 * 1024, // 8MB
        contentType: 'image/jpeg'
      },
      {
        fileName: 'groom_portrait.jpg',
        url: 'https://picsum.photos/3000/4000',
        size: 6 * 1024 * 1024, // 6MB
        contentType: 'image/jpeg'
      },
      {
        fileName: 'group_photo.jpg',
        url: 'https://picsum.photos/5000/3000',
        size: 12 * 1024 * 1024, // 12MB
        contentType: 'image/jpeg'
      }
    ]
  }
};

async function testGoogleCloudFunction() {
  console.log('🧪 Testing Google Cloud Function with large files...');
  console.log('📋 Test configuration:');
  console.log(`   Function URL: ${TEST_CONFIG.functionUrl}`);
  console.log(`   Test files: ${TEST_CONFIG.testPayload.photos.length}`);
  console.log(`   Total size: ${(TEST_CONFIG.testPayload.photos.reduce((sum, p) => sum + p.size, 0) / 1024 / 1024).toFixed(2)}MB`);
  console.log(`   Large files: ${TEST_CONFIG.testPayload.photos.filter(p => p.size > 200 * 1024 * 1024).length}`);
  
  try {
    console.log('\n🚀 Sending request to Google Cloud Function...');
    
    const startTime = Date.now();
    const response = await fetch(TEST_CONFIG.functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(TEST_CONFIG.testPayload)
    });
    
    const responseTime = Date.now() - startTime;
    console.log(`⏱️ Response time: ${responseTime}ms`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('\n✅ Google Cloud Function response:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n🎉 Test successful! Google Cloud Function accepted the request.');
      console.log(`📧 Processing will continue asynchronously. Check ${TEST_CONFIG.testPayload.email} for completion email.`);
      console.log(`⏰ Estimated completion: ${result.estimatedTime || '5-15 minutes'}`);
    } else {
      console.log('\n❌ Test failed: Function rejected the request');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    
    if (error.message.includes('ENOTFOUND') || error.message.includes('fetch')) {
      console.log('\n💡 Troubleshooting tips:');
      console.log('1. Make sure you\'ve deployed the Google Cloud Function');
      console.log('2. Update the functionUrl in this test file');
      console.log('3. Verify the function is publicly accessible');
      console.log('4. Check your Google Cloud project settings');
    }
  }
}

async function testRouting() {
  console.log('\n🎯 Testing size-based routing logic...');
  
  const photos = TEST_CONFIG.testPayload.photos;
  const GOOGLE_CLOUD_THRESHOLD = 200 * 1024 * 1024; // 200MB
  
  let hasLargeFile = false;
  const largeFiles = [];
  
  for (const photo of photos) {
    if (photo.size > GOOGLE_CLOUD_THRESHOLD) {
      hasLargeFile = true;
      largeFiles.push({
        fileName: photo.fileName,
        sizeMB: (photo.size / 1024 / 1024).toFixed(2)
      });
    }
  }
  
  console.log(`📊 Analysis results:`);
  console.log(`   Has large files (>200MB): ${hasLargeFile}`);
  console.log(`   Should route to Google Cloud: ${hasLargeFile}`);
  console.log(`   Large files detected: ${largeFiles.length}`);
  
  if (largeFiles.length > 0) {
    console.log(`   Large files:`);
    largeFiles.forEach(file => {
      console.log(`     - ${file.fileName} (${file.sizeMB}MB)`);
    });
  }
  
  console.log(`\n🎯 Routing decision: ${hasLargeFile ? 'Google Cloud Functions' : 'Cloudflare Workers'}`);
  console.log(`   Reason: ${hasLargeFile ? 'Large files detected' : 'All files ≤200MB'}`);
}

// Run tests
async function runTests() {
  console.log('🧪 Google Cloud Function Large File Test Suite\n');
  
  // Test 1: Routing logic
  await testRouting();
  
  // Test 2: Function call (only if URL is configured)
  if (TEST_CONFIG.functionUrl.includes('your-region-your-project')) {
    console.log('\n⚠️ Skipping function call test - please update functionUrl in test file');
    console.log('   Update TEST_CONFIG.functionUrl with your deployed function URL');
  } else {
    await testGoogleCloudFunction();
  }
  
  console.log('\n🏁 Test suite complete!');
}

// Run the tests
runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
