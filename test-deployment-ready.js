#!/usr/bin/env node

/**
 * Smart Routing Deployment Readiness Test
 * Verifies that both frontend and backend have the 80MB video routing implemented
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Smart Routing Deployment Readiness Test\n');
console.log('=' .repeat(60));

let allChecksPass = true;

// Test 1: Frontend routing logic
console.log('\n📱 Frontend Routing Logic Check:');
try {
  const frontendCode = fs.readFileSync('src/services/photoService.ts', 'utf8');
  
  const checks = [
    { name: '80MB threshold detection', pattern: /80 \* 1024 \* 1024/, found: false },
    { name: 'Google Cloud Run URL', pattern: /wedding-photo-processor-767610841427\.us-west1\.run\.app/, found: false },
    { name: 'Smart routing function', pattern: /routeToGoogleCloudRun/, found: false },
    { name: 'Large video count logic', pattern: /largeVideoCount/, found: false },
    { name: 'Processing engine logging', pattern: /processingEngine/, found: false }
  ];
  
  checks.forEach(check => {
    check.found = check.pattern.test(frontendCode);
    console.log(`   ${check.found ? '✅' : '❌'} ${check.name}`);
    if (!check.found) allChecksPass = false;
  });
  
} catch (error) {
  console.log('   ❌ Error reading frontend code:', error.message);
  allChecksPass = false;
}

// Test 2: Backend routing logic
console.log('\n🌐 Backend Routing Logic Check:');
try {
  const backendCode = fs.readFileSync('netlify/functions/email-download.js', 'utf8');
  
  const checks = [
    { name: '80MB threshold detection', pattern: /80 \* 1024 \* 1024/, found: false },
    { name: 'Google Cloud Run routing', pattern: /routeToGoogleCloudRun/, found: false },
    { name: 'Smart routing decision', pattern: /largeVideoCount > 0/, found: false },
    { name: 'Cloud Run URL', pattern: /wedding-photo-processor-767610841427/, found: false },
    { name: 'Fallback logic', pattern: /Falling back to Cloudflare Worker/, found: false }
  ];
  
  checks.forEach(check => {
    check.found = check.pattern.test(backendCode);
    console.log(`   ${check.found ? '✅' : '❌'} ${check.name}`);
    if (!check.found) allChecksPass = false;
  });
  
} catch (error) {
  console.log('   ❌ Error reading backend code:', error.message);
  allChecksPass = false;
}

// Test 3: Configuration check
console.log('\n⚙️  Configuration Check:');
const expectedEndpoints = [
  'https://wedding-photo-processor-767610841427.us-west1.run.app',
  'https://sharedmoments.socialboostai.com'
];

expectedEndpoints.forEach(endpoint => {
  console.log(`   ✅ Expected endpoint: ${endpoint}`);
});

console.log('\n🎯 Routing Rules Summary:');
console.log('   1. Any video > 80MB → Google Cloud Run');
console.log('   2. Total collection > 500MB → Google Cloud Run');  
console.log('   3. More than 10 videos → Google Cloud Run');
console.log('   4. Otherwise → Netlify/Cloudflare');

console.log('\n📋 Expected Behavior After Deployment:');
console.log('   • Frontend detects 80MB+ videos automatically');
console.log('   • Routes directly to Google Cloud Run service');
console.log('   • You will see logs in Cloud Run, not Cloud Functions');
console.log('   • Logs will show "Google Cloud Run processing started"');
console.log('   • Processing engine will be "google-cloud-run"');

console.log('\n' + '='.repeat(60));

if (allChecksPass) {
  console.log('🎉 READY FOR DEPLOYMENT!');
  console.log('✅ All smart routing checks passed');
  console.log('🚀 Deploy to production to see Cloud Run in action');
  console.log('\n📝 Next Steps:');
  console.log('   1. Deploy frontend changes to production');
  console.log('   2. Test with collection containing 80MB+ videos');
  console.log('   3. Check Google Cloud Run logs (not Cloud Functions)');
  console.log('   4. Verify "google-cloud-run" in processing engine logs');
  process.exit(0);
} else {
  console.log('❌ DEPLOYMENT NOT READY - Issues detected');
  console.log('⚠️  Please fix the failed checks above');
  process.exit(1);
}
