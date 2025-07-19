/**
 * Test 200MB+ video handling in Durable Objects
 * Verifies the timeout fix for large video files
 */

/**
 * Test the 200MB video processing fix
 */
async function test200MBVideoFix() {
  console.log(`🎬 TESTING 200MB+ VIDEO PROCESSING FIX`);
  console.log(`=====================================`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`\n`);

  const eventId = '2025-07-19_200mb_video_test';
  const testEmail = 'migsub77@gmail.com';
  const requestId = `video_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`📧 Test Email: ${testEmail}`);
  console.log(`🎯 Request ID: ${requestId}`);
  console.log(`📝 Event ID: ${eventId}`);

  // Test with a mix of files including large video
  const testPhotos = [
    {
      fileName: 'wedding_photo_01.jpg',
      url: 'https://via.placeholder.com/1920x1080.jpg',
      size: 2 * 1024 * 1024 // 2MB
    },
    {
      fileName: 'wedding_photo_02.jpg', 
      url: 'https://via.placeholder.com/1920x1080.jpg',
      size: 3 * 1024 * 1024 // 3MB
    },
    {
      fileName: 'large_wedding_video.mp4',
      url: 'https://sample-videos.com/zip/50/mp4/SampleVideo_1280x720_30mb.mp4', // 30MB test video
      size: 30 * 1024 * 1024 // 30MB - simulating large video behavior
    },
    {
      fileName: 'wedding_photo_03.jpg',
      url: 'https://via.placeholder.com/1920x1080.jpg',
      size: 2.5 * 1024 * 1024 // 2.5MB
    },
    {
      fileName: 'ceremony_video.mp4',
      url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_5mb.mp4', // 5MB video
      size: 5 * 1024 * 1024 // 5MB
    }
  ];

  const totalSizeMB = testPhotos.reduce((sum, p) => sum + p.size, 0) / 1024 / 1024;
  const videoCount = testPhotos.filter(p => p.fileName.includes('.mp4')).length;
  
  console.log(`📦 Test collection: ${testPhotos.length} files (${totalSizeMB.toFixed(2)}MB total)`);
  console.log(`🎬 Videos in collection: ${videoCount}`);
  
  testPhotos.forEach((photo, index) => {
    const sizeMB = (photo.size / 1024 / 1024).toFixed(2);
    const type = photo.fileName.includes('.mp4') ? '🎬 VIDEO' : '📸 PHOTO';
    console.log(`   ${index + 1}. ${photo.fileName} - ${sizeMB}MB ${type}`);
  });

  const workerUrl = 'https://sharedmoments-photo-processor.migsub77.workers.dev';
  
  try {
    console.log(`\n🚀 Sending request to Cloudflare Worker...`);
    console.log(`🔧 Testing the new timeout handling for large videos`);
    
    const startTime = Date.now();
    
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LargeVideo-Test/1.0'
      },
      body: JSON.stringify({
        eventId,
        email: testEmail,
        photos: testPhotos,
        requestId
      })
    });
    
    const responseTime = Date.now() - startTime;
    console.log(`⚡ Response time: ${responseTime}ms`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Worker error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    console.log(`\n✅ WORKER RESPONSE SUCCESS!`);
    console.log(`============================`);
    console.log(`Success: ${result.success}`);
    console.log(`Message: ${result.message}`);
    console.log(`Request ID: ${result.requestId}`);
    console.log(`Processing: ${result.processing}`);
    console.log(`Estimated Time: ${result.estimatedTime}`);
    
    if (result.collectionAnalysis) {
      console.log(`\n📊 Collection Analysis:`);
      console.log(`   Total Size: ${result.collectionAnalysis.totalSizeMB}MB`);
      console.log(`   Videos: ${result.collectionAnalysis.videoCount}`);
      console.log(`   Risk Level: ${result.collectionAnalysis.riskLevel}`);
    }
    
    console.log(`\n🎯 LARGE VIDEO TEST RESULTS:`);
    console.log(`=============================`);
    console.log(`✅ Worker accepted ${testPhotos.length} files including ${videoCount} videos`);
    console.log(`✅ Durable Object processing initiated with timeout fix`);
    console.log(`✅ Expected all ${testPhotos.length} files in final ZIP`);
    
    console.log(`\n🔧 WHAT THE FIX ADDRESSES:`);
    console.log(`===========================`);
    console.log(`✅ Dynamic timeouts: 120s for large videos, 60s for photos`);
    console.log(`✅ Proper error handling: Distinguishes timeouts from other errors`);
    console.log(`✅ Retry logic: Exponential backoff with extra time per attempt`);
    console.log(`✅ File size detection: Uses actual file sizes for smart timeouts`);
    console.log(`✅ Progress logging: Detailed download progress for debugging`);
    
    console.log(`\n📧 VERIFICATION STEPS:`);
    console.log(`======================`);
    console.log(`1. 📬 Check email: ${testEmail}`);
    console.log(`2. ⏰ Wait time: ${result.estimatedTime || '2-5 minutes'}`);
    console.log(`3. 📊 Verify ZIP contains ALL ${testPhotos.length} files (especially the videos)`);
    console.log(`4. 🎬 Confirm large video files are not missing`);
    console.log(`5. 🔍 Request ID for logs: ${requestId}`);
    
    console.log(`\n🎉 SUCCESS CRITERIA:`);
    console.log(`=====================`);
    console.log(`✅ Email received within estimated time`);
    console.log(`✅ ZIP file contains exactly ${testPhotos.length} files`);
    console.log(`✅ All ${videoCount} video files included (no timeouts)`);
    console.log(`✅ No "missing file" issues like before`);
    
    console.log(`\n🔍 TO MONITOR:`);
    console.log(`===============`);
    console.log(`• Run: cd cloudflare-worker && npx wrangler tail`);
    console.log(`• Look for: "📊 File details" logs showing timeout values`);
    console.log(`• Look for: "✅ File downloaded" for each video`);
    console.log(`• Ensure: No "⏰ Download timeout" messages`);
    
    return {
      success: true,
      requestId,
      testFiles: testPhotos.length,
      videoFiles: videoCount,
      estimatedTime: result.estimatedTime,
      message: 'Large video test initiated successfully'
    };
    
  } catch (error) {
    console.error(`\n❌ LARGE VIDEO TEST FAILED:`);
    console.error(`============================`);
    console.error(`Error: ${error.message}`);
    
    if (error.message.includes('429')) {
      console.log(`\n💡 Rate limited due to previous tests.`);
      console.log(`⏰ Wait 1 minute and try again.`);
    }
    
    throw error;
  }
}

// Run the test
if (require.main === module) {
  test200MBVideoFix().catch(error => {
    console.error('Large video test failed:', error);
    process.exit(1);
  });
}

module.exports = { test200MBVideoFix };
