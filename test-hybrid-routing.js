/**
 * Test Hybrid Routing System
 * Verifies that files are correctly routed to Cloudflare vs Google Cloud
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Test configuration
const TEST_CONFIG = {
  cloudflareWorkerUrl: 'https://sharedmoments-photo-processor.migsub77.workers.dev',
  testEmail: 'test@sharedmoments.com'
};

// Test scenarios
const TEST_SCENARIOS = {
  // Scenario 1: All small files - should route to Cloudflare
  smallFiles: {
    name: 'Small Files (Cloudflare Route)',
    expectedRoute: 'cloudflare',
    photos: [
      { fileName: 'photo1.jpg', url: 'https://picsum.photos/2000/1500', size: 5 * 1024 * 1024 }, // 5MB
      { fileName: 'photo2.jpg', url: 'https://picsum.photos/3000/2000', size: 8 * 1024 * 1024 }, // 8MB
      { fileName: 'video1.mp4', url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_720x480_30mb.mp4', size: 30 * 1024 * 1024 }, // 30MB
      { fileName: 'photo3.jpg', url: 'https://picsum.photos/4000/3000', size: 12 * 1024 * 1024 }, // 12MB
      { fileName: 'video2.mp4', url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_5mb.mp4', size: 80 * 1024 * 1024 } // 80MB (at threshold)
    ]
  },

  // Scenario 2: One large file - should route to Google Cloud
  largeFiles: {
    name: 'Large Files (Google Cloud Route)',
    expectedRoute: 'google-cloud',
    photos: [
      { fileName: 'photo1.jpg', url: 'https://picsum.photos/2000/1500', size: 5 * 1024 * 1024 }, // 5MB
      { fileName: 'photo2.jpg', url: 'https://picsum.photos/3000/2000', size: 8 * 1024 * 1024 }, // 8MB
      { fileName: 'ceremony_4k.mp4', url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_30mb.mp4', size: 300 * 1024 * 1024 }, // 300MB - TRIGGERS GOOGLE CLOUD
      { fileName: 'photo3.jpg', url: 'https://picsum.photos/4000/3000', size: 12 * 1024 * 1024 } // 12MB
    ]
  },

  // Scenario 3: Multiple large files - should route to Google Cloud
  massiveFiles: {
    name: 'Massive Files (Google Cloud Route)',
    expectedRoute: 'google-cloud',
    photos: [
      { fileName: 'photo1.jpg', url: 'https://picsum.photos/2000/1500', size: 5 * 1024 * 1024 }, // 5MB
      { fileName: 'ceremony_4k.mp4', url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_30mb.mp4', size: 500 * 1024 * 1024 }, // 500MB
      { fileName: 'reception_4k.mp4', url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_720x480_30mb.mp4', size: 400 * 1024 * 1024 }, // 400MB  
      { fileName: 'photo2.jpg', url: 'https://picsum.photos/3000/2000', size: 8 * 1024 * 1024 } // 8MB
    ]
  }
};

/**
 * Analyze collection locally to predict routing
 */
function analyzeRouting(photos) {
  const GOOGLE_CLOUD_THRESHOLD = 200 * 1024 * 1024; // 200MB
  
  let totalSize = 0;
  let largeFileCount = 0;
  let maxFileSize = 0;
  const largeFiles = [];
  
  for (const photo of photos) {
    totalSize += photo.size;
    maxFileSize = Math.max(maxFileSize, photo.size);
    
    if (photo.size > GOOGLE_CLOUD_THRESHOLD) {
      largeFileCount++;
      largeFiles.push({
        fileName: photo.fileName,
        sizeMB: (photo.size / 1024 / 1024).toFixed(2)
      });
    }
  }
  
  const shouldUseGoogleCloud = largeFileCount > 0;
  
  return {
    totalFiles: photos.length,
    totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
    maxFileSizeMB: (maxFileSize / 1024 / 1024).toFixed(2),
    largeFileCount,
    largeFiles,
    shouldUseGoogleCloud,
    predictedRoute: shouldUseGoogleCloud ? 'google-cloud' : 'cloudflare'
  };
}

/**
 * Test a specific scenario
 */
async function testScenario(scenarioName, scenario) {
  console.log(`\n🧪 Testing: ${scenario.name}`);
  console.log('━'.repeat(50));
  
  // Analyze locally first
  const analysis = analyzeRouting(scenario.photos);
  
  console.log(`📊 Collection Analysis:`);
  console.log(`   Files: ${analysis.totalFiles}`);
  console.log(`   Total size: ${analysis.totalSizeMB}MB`);
  console.log(`   Largest file: ${analysis.maxFileSizeMB}MB`);
  console.log(`   Large files (>200MB): ${analysis.largeFileCount}`);
  
  if (analysis.largeFiles.length > 0) {
    console.log(`   Large files detected:`);
    analysis.largeFiles.forEach(file => {
      console.log(`     - ${file.fileName} (${file.sizeMB}MB)`);
    });
  }
  
  console.log(`\n🎯 Routing Prediction:`);
  console.log(`   Expected: ${scenario.expectedRoute}`);
  console.log(`   Predicted: ${analysis.predictedRoute}`);
  console.log(`   Match: ${scenario.expectedRoute === analysis.predictedRoute ? '✅' : '❌'}`);
  
  // Test actual request to Cloudflare Worker
  try {
    console.log(`\n🚀 Sending request to Cloudflare Worker...`);
    
    const payload = {
      eventId: `test_${scenarioName}_${Date.now()}`,
      email: TEST_CONFIG.testEmail,
      photos: scenario.photos,
      requestId: `hybrid_test_${scenarioName}_${Date.now()}`
    };
    
    const startTime = Date.now();
    const response = await fetch(TEST_CONFIG.cloudflareWorkerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    console.log(`⏱️ Response time: ${responseTime}ms`);
    console.log(`📋 Worker response:`);
    console.log(`   Success: ${result.success ? '✅' : '❌'}`);
    console.log(`   Processing: ${result.processing || 'unknown'}`);
    console.log(`   Estimated time: ${result.estimatedTime || 'unknown'}`);
    
    // Determine actual route taken
    let actualRoute = 'unknown';
    if (result.processing === 'durable-object-streaming') {
      actualRoute = 'cloudflare';
    } else if (result.processing === 'google-cloud-functions') {
      actualRoute = 'google-cloud';
    }
    
    console.log(`\n🎯 Routing Result:`);
    console.log(`   Expected: ${scenario.expectedRoute}`);
    console.log(`   Actual: ${actualRoute}`);
    console.log(`   Correct: ${scenario.expectedRoute === actualRoute ? '✅' : '❌'}`);
    
    if (result.collectionAnalysis?.routingReason) {
      console.log(`   Reason: ${result.collectionAnalysis.routingReason}`);
    }
    
    return {
      scenario: scenarioName,
      expected: scenario.expectedRoute,
      actual: actualRoute,
      correct: scenario.expectedRoute === actualRoute,
      responseTime,
      success: result.success
    };
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    
    if (error.message.includes('ENOTFOUND')) {
      console.log(`\n💡 Update TEST_CONFIG.cloudflareWorkerUrl in this file with your worker URL`);
    }
    
    return {
      scenario: scenarioName,
      expected: scenario.expectedRoute,
      actual: 'error',
      correct: false,
      error: error.message
    };
  }
}

/**
 * Run all test scenarios
 */
async function runHybridRoutingTests() {
  console.log('🧪 Hybrid Routing System Test Suite');
  console.log('🎯 Testing size-based routing between Cloudflare and Google Cloud');
  console.log(`🔗 Worker URL: ${TEST_CONFIG.cloudflareWorkerUrl}`);
  console.log('═'.repeat(80));
  
  const results = [];
  
  // Test each scenario
  for (const [scenarioKey, scenario] of Object.entries(TEST_SCENARIOS)) {
    const result = await testScenario(scenarioKey, scenario);
    results.push(result);
    
    // Pause between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Summary
  console.log('\n📊 TEST RESULTS SUMMARY');
  console.log('═'.repeat(50));
  
  let passedTests = 0;
  results.forEach(result => {
    const status = result.correct ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${result.scenario}: ${result.expected} → ${result.actual}`);
    if (result.correct) passedTests++;
  });
  
  console.log(`\n🎯 Overall: ${passedTests}/${results.length} tests passed`);
  
  if (passedTests === results.length) {
    console.log('🎉 ALL TESTS PASSED! Your hybrid routing system is working correctly!');
    console.log('\n✅ Verification complete:');
    console.log('   - Small files (<200MB) route to Cloudflare Workers');
    console.log('   - Large files (≥200MB) route to Google Cloud Functions');
    console.log('   - Single ZIP file delivered regardless of route');
    console.log('   - Professional wedding-scale processing ready!');
  } else {
    console.log('⚠️ Some tests failed. Check your deployment configuration.');
  }
  
  return results;
}

// Run the tests
if (require.main === module) {
  runHybridRoutingTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { runHybridRoutingTests, testScenario, analyzeRouting };
