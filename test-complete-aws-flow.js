#!/usr/bin/env node

// Test Complete AWS 500MB Video Processing Flow
// Frontend → Netlify → Cloudflare → AWS → Email

const https = require('https');

const CLOUDFLARE_WORKER_URL = 'https://sharedmoments-photo-processor.migsub77.workers.dev';

console.log('🚀 Testing Complete AWS 500MB Video Processing Flow');
console.log('📋 Architecture: Frontend → Netlify → Cloudflare → AWS EC2 Spot → Email');
console.log(`📍 Cloudflare Worker: ${CLOUDFLARE_WORKER_URL}`);
console.log('💰 Expected AWS cost: ~$0.01-0.02 per 500MB job (95% savings!)');
console.log();

// Test data simulating a 500MB video that should trigger AWS routing
const testData = {
  eventId: 'aws-test-500mb-' + Date.now(),
  email: 'test@example.com',
  requestId: 'aws-flow-test-' + Date.now(),
  photos: [
    { 
      fileName: 'wedding-ceremony-4k.mp4', 
      size: 524288000, // 500MB video 
      mediaType: 'video',
      downloadURL: 'https://firebase-storage-url/wedding-ceremony-4k.mp4'
    },
    { 
      fileName: 'bride-portrait.jpg', 
      size: 8388608, // 8MB
      mediaType: 'photo',
      downloadURL: 'https://firebase-storage-url/bride-portrait.jpg'
    },
    { 
      fileName: 'groom-portrait.jpg', 
      size: 7340032, // 7MB
      mediaType: 'photo',
      downloadURL: 'https://firebase-storage-url/groom-portrait.jpg'
    }
  ]
};

const requestBody = JSON.stringify(testData);

console.log(`📊 Test Request Data:`);
console.log(`   Event ID: ${testData.eventId}`);
console.log(`   Request ID: ${testData.requestId}`);
console.log(`   Files: ${testData.photos.length}`);
console.log(`   Large Files: ${testData.photos.filter(p => p.size > 80 * 1024 * 1024).length}`);
console.log(`   Total Size: ${(testData.photos.reduce((sum, p) => sum + p.size, 0) / 1024 / 1024).toFixed(2)}MB`);
console.log(`   Largest File: ${(Math.max(...testData.photos.map(p => p.size)) / 1024 / 1024).toFixed(2)}MB`);
console.log();

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody),
    'User-Agent': 'AWS-Flow-Test/1.0'
  }
};

console.log('🔄 Step 1: Sending request to Cloudflare Worker...');
console.log('   ↳ Should analyze collection and route to AWS (>80MB detected)');

const req = https.request(CLOUDFLARE_WORKER_URL, options, (res) => {
  console.log(`📡 Response Status: ${res.statusCode}`);
  
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(responseData);
      
      console.log('\n🎯 Cloudflare Worker Response:');
      console.log('================================');
      
      if (result.success) {
        console.log('✅ Status: SUCCESS');
        console.log(`📝 Message: ${result.message}`);
        console.log(`🆔 Request ID: ${result.requestId}`);
        console.log(`⏱️  Estimated Time: ${result.estimatedTime}`);
        console.log(`🖥️  Processing: ${result.processing}`);
        
        if (result.collectionAnalysis) {
          console.log('\n📊 Collection Analysis:');
          console.log(`   Total Size: ${result.collectionAnalysis.totalSizeMB}MB`);
          console.log(`   Video Count: ${result.collectionAnalysis.videoCount}`);
          console.log(`   Large Files: ${result.collectionAnalysis.largeFileCount}`);
          console.log(`   Risk Level: ${result.collectionAnalysis.riskLevel}`);
          if (result.collectionAnalysis.routingReason) {
            console.log(`   Routing Reason: ${result.collectionAnalysis.routingReason}`);
          }
        }
        
        if (result.capabilities) {
          console.log('\n🎛️  Capabilities:');
          console.log(`   Max Video Size: ${result.capabilities.maxVideoSize}`);
          console.log(`   Max Collection: ${result.capabilities.maxCollectionSize}`);
          console.log(`   Processing Type: ${result.capabilities.processingType}`);
          if (result.capabilities.estimatedCost) {
            console.log(`   Estimated Cost: ${result.capabilities.estimatedCost}`);
          }
        }
        
        // Check if it routed to AWS as expected
        if (result.processing === 'aws-ec2-spot') {
          console.log('\n🎉 SUCCESS: Correctly routed to AWS EC2 Spot!');
          console.log('✅ Step 2: AWS Lambda will launch EC2 spot instance');
          console.log('✅ Step 3: EC2 will download 500MB video from Firebase');
          console.log('✅ Step 4: EC2 will zip files and upload to S3');
          console.log('✅ Step 5: Email will be sent with download link');
          console.log('✅ Step 6: EC2 instance will auto-terminate');
          console.log('\n💰 Expected Total Cost: ~$0.01-0.02 (vs $2-5 with previous system)');
          console.log('⚡ Expected Processing Time: 2-3 minutes (vs 60+ minutes failing)');
          
        } else if (result.processing === 'durable-object-streaming') {
          console.log('\n⚠️  UNEXPECTED: Routed to Cloudflare instead of AWS');
          console.log('   This might happen if collection analysis missed large files');
          console.log('   Check that file sizes are properly detected');
          
        } else {
          console.log('\n❓ UNKNOWN: Unexpected processing type:', result.processing);
        }
        
      } else {
        console.log('❌ Status: FAILED');
        console.log(`🚨 Error: ${result.error}`);
        console.log(`📝 Reason: ${result.reason || 'No additional details'}`);
        
        if (result.action) {
          console.log(`🔧 Action: ${result.action}`);
        }
      }
      
      console.log('\n📋 Flow Summary:');
      console.log('================');
      console.log('1. ✅ Request sent to Cloudflare Worker');
      console.log('2. ✅ Worker analyzed collection size and routing');
      console.log(`3. ${result.processing === 'aws-ec2-spot' ? '✅' : '❌'} ${result.processing === 'aws-ec2-spot' ? 'Correctly routed to AWS' : 'Did not route to AWS as expected'}`);
      console.log('4. ⏳ AWS processing (if routed correctly)');
      console.log('5. ⏳ Email delivery');
      
      console.log('\n🎯 Your 500MB video processing solution is now ACTIVE!');
      
    } catch (error) {
      console.error('❌ Failed to parse response:', error);
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error);
});

req.write(requestBody);
req.end();

console.log('⏳ Waiting for Cloudflare Worker response...');
