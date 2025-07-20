#!/usr/bin/env node

/**
 * Cloud Run Wedding Photo Processor - Post-Deployment Test
 * Tests all endpoints and functionality after deployment
 */

const https = require('https');
const http = require('http');

const BASE_URL = 'https://wedding-photo-processor-767610841427.us-west1.run.app';
const TEST_EVENT_ID = 'test-wedding-1752980257932';

console.log('🧪 Testing Cloud Run Wedding Photo Processor Deployment');
console.log('================================================\n');

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data.startsWith('{') || data.startsWith('[') ? JSON.parse(data) : data;
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Test functions
async function testHealthEndpoint() {
  console.log('1️⃣ Testing Health Endpoint...');
  try {
    const response = await makeRequest(`${BASE_URL}/`);
    
    if (response.status === 200) {
      console.log('✅ Base endpoint responding');
      console.log('   Status:', response.data.status);
      console.log('   Service:', response.data.service);
      console.log('   Version:', response.data.version);
    } else {
      console.log('❌ Base endpoint failed:', response.status);
      console.log('   Response:', response.data);
    }
  } catch (error) {
    console.log('❌ Health endpoint error:', error.message);
  }
  console.log('');
}

async function testDetailedHealthEndpoint() {
  console.log('2️⃣ Testing Detailed Health Endpoint...');
  try {
    const response = await makeRequest(`${BASE_URL}/health`);
    
    if (response.status === 200) {
      console.log('✅ Detailed health endpoint responding');
      console.log('   Uptime:', response.data.uptime?.toFixed(2), 'seconds');
      console.log('   Memory RSS:', (response.data.memory?.rss / 1024 / 1024)?.toFixed(2), 'MB');
      console.log('   Environment:', response.data.environment);
    } else {
      console.log('❌ Detailed health endpoint failed:', response.status);
    }
  } catch (error) {
    console.log('❌ Detailed health endpoint error:', error.message);
  }
  console.log('');
}

async function testConfigCheck() {
  console.log('3️⃣ Testing Configuration Check...');
  try {
    const response = await makeRequest(`${BASE_URL}/config-check`);
    
    if (response.status === 200) {
      console.log('✅ Config check endpoint responding');
      console.log('   Status:', response.data.status);
      console.log('   Firebase configured:', response.data.firebase?.configured);
      console.log('   R2 configured:', response.data.r2?.configured);
      console.log('   Email configured:', response.data.email?.configured);
    } else if (response.status === 500) {
      console.log('⚠️ Config check shows configuration issues (expected if env vars not set)');
      console.log('   Status:', response.data.status);
      console.log('   Message:', response.data.message);
    } else {
      console.log('❌ Config check failed:', response.status);
    }
  } catch (error) {
    console.log('❌ Config check error:', error.message);
  }
  console.log('');
}

async function testFirestoreDebug() {
  console.log('4️⃣ Testing Firestore Debug Endpoint...');
  try {
    const response = await makeRequest(`${BASE_URL}/debug/firestore/${TEST_EVENT_ID}`);
    
    if (response.status === 200) {
      console.log('✅ Firestore debug endpoint responding');
      console.log('   Event ID:', response.data.eventId);
      console.log('   Photo count:', response.data.photoCount);
      console.log('   Firestore connection:', response.data.firestoreConnection);
    } else if (response.status === 500) {
      console.log('⚠️ Firestore debug shows connection issues (expected if not configured)');
      console.log('   Error:', response.data.error);
      console.log('   Connection status:', response.data.firestoreConnection);
    } else {
      console.log('❌ Firestore debug failed:', response.status);
    }
  } catch (error) {
    console.log('❌ Firestore debug error:', error.message);
  }
  console.log('');
}

async function testR2Debug() {
  console.log('5️⃣ Testing R2 Debug Endpoint...');
  try {
    const response = await makeRequest(`${BASE_URL}/debug/r2-test`);
    
    if (response.status === 200) {
      console.log('✅ R2 debug endpoint responding');
      console.log('   R2 connection:', response.data.r2Connection);
      console.log('   Bucket:', response.data.bucket);
      console.log('   Object count:', response.data.objectCount);
    } else if (response.status === 500) {
      console.log('⚠️ R2 debug shows connection issues (expected if not configured)');
      console.log('   Error:', response.data.error);
      console.log('   Connection status:', response.data.r2Connection);
    } else {
      console.log('❌ R2 debug failed:', response.status);
    }
  } catch (error) {
    console.log('❌ R2 debug error:', error.message);
  }
  console.log('');
}

async function testProcessPhotosEndpoint() {
  console.log('6️⃣ Testing Process Photos Endpoint...');
  try {
    const response = await makeRequest(`${BASE_URL}/process-photos`, {
      method: 'POST',
      body: {
        eventId: TEST_EVENT_ID,
        email: 'test@example.com'
      }
    });
    
    if (response.status === 200) {
      console.log('✅ Process photos endpoint responding');
      console.log('   Message:', response.data.message);
      console.log('   File count:', response.data.fileCount);
      console.log('   Request ID:', response.data.requestId);
    } else if (response.status === 404) {
      console.log('⚠️ Process photos returns 404 (expected if no photos found)');
      console.log('   Error:', response.data.error);
    } else if (response.status === 500) {
      console.log('⚠️ Process photos has configuration issues');
      console.log('   Error:', response.data.error);
    } else {
      console.log('❌ Process photos failed:', response.status);
      console.log('   Response:', response.data);
    }
  } catch (error) {
    console.log('❌ Process photos error:', error.message);
  }
  console.log('');
}

async function testInvalidEndpoint() {
  console.log('7️⃣ Testing Invalid Endpoint (Should Return 404)...');
  try {
    const response = await makeRequest(`${BASE_URL}/nonexistent`);
    
    if (response.status === 404) {
      console.log('✅ Invalid endpoint correctly returns 404');
    } else {
      console.log('❌ Invalid endpoint should return 404, got:', response.status);
    }
  } catch (error) {
    console.log('❌ Invalid endpoint test error:', error.message);
  }
  console.log('');
}

// Main test runner
async function runAllTests() {
  const startTime = Date.now();
  
  console.log(`🎯 Target: ${BASE_URL}`);
  console.log(`📅 Time: ${new Date().toLocaleString()}\n`);
  
  await testHealthEndpoint();
  await testDetailedHealthEndpoint();
  await testConfigCheck();
  await testFirestoreDebug();
  await testR2Debug();
  await testProcessPhotosEndpoint();
  await testInvalidEndpoint();
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('📊 Test Summary');
  console.log('===============');
  console.log(`⏱️ Total test time: ${duration} seconds`);
  console.log('🎯 Service URL:', BASE_URL);
  console.log('');
  
  console.log('📋 Next Steps:');
  console.log('1. If all endpoints respond → ✅ Deployment successful!');
  console.log('2. If config issues shown → Set environment variables in Cloud Run');
  console.log('3. If 404 errors → Redeploy with latest code');
  console.log('4. If connection errors → Check network/DNS');
  console.log('');
  
  console.log('🔧 Environment Variables Needed:');
  console.log('- FIREBASE_API_KEY, FIREBASE_PROJECT_ID, etc.');
  console.log('- R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, etc.');
  console.log('- EMAIL_USER, EMAIL_PASSWORD');
  console.log('');
  
  console.log('📖 See CLOUD_RUN_STARTUP_ISSUES_COMPLETE_FIX.md for complete setup guide');
}

// Run tests
runAllTests().catch(console.error);
