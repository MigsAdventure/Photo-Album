#!/usr/bin/env node

/**
 * Comprehensive Test Script for Cloud Run Wedding Photo Processor
 * Tests all the fixes implemented for the environment variable and endpoint issues
 */

const https = require('https');
const http = require('http');

// Configuration - Update this URL after deployment
const SERVICE_URL = 'https://wedding-photo-processor-767610841427.us-west1.run.app';
const TEST_EVENT_ID = 'test-wedding-1752980257932';
const TEST_EMAIL = 'test@example.com';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function makeRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Cloud-Run-Test-Script/1.0'
      }
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const lib = urlObj.protocol === 'https:' ? https : http;
    
    const req = lib.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            data: parsedData,
            headers: res.headers
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            data: responseData,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testEndpoint(name, url, expectedStatus = 200, method = 'GET', data = null) {
  try {
    log(colors.blue, `\n🧪 Testing ${name}...`);
    log(colors.blue, `   ${method} ${url}`);
    
    const startTime = Date.now();
    const response = await makeRequest(url, method, data);
    const duration = Date.now() - startTime;
    
    if (response.statusCode === expectedStatus) {
      log(colors.green, `   ✅ ${name} passed (${response.statusCode}) - ${duration}ms`);
      
      if (typeof response.data === 'object') {
        console.log('   📄 Response:', JSON.stringify(response.data, null, 2));
      }
      
      return { success: true, response };
    } else {
      log(colors.red, `   ❌ ${name} failed - Expected ${expectedStatus}, got ${response.statusCode}`);
      console.log('   📄 Response:', response.data);
      return { success: false, response };
    }
  } catch (error) {
    log(colors.red, `   ❌ ${name} failed with error: ${error.message}`);
    return { success: false, error };
  }
}

async function runAllTests() {
  log(colors.bold + colors.blue, '🚀 Starting Cloud Run Wedding Photo Processor Tests');
  log(colors.blue, `📍 Testing service at: ${SERVICE_URL}`);
  log(colors.blue, '=' .repeat(70));

  const results = [];

  // Test 1: Basic health check
  const healthTest = await testEndpoint(
    'Health Check',
    `${SERVICE_URL}/health`
  );
  results.push(healthTest);

  // Test 2: Root endpoint
  const rootTest = await testEndpoint(
    'Root Endpoint',
    `${SERVICE_URL}/`
  );
  results.push(rootTest);

  // Test 3: Config check (this was missing and causing 404s)
  const configTest = await testEndpoint(
    'Config Check (Was Missing!)',
    `${SERVICE_URL}/config-check`
  );
  results.push(configTest);

  // Test 4: Debug R2 connection
  const r2Test = await testEndpoint(
    'R2 Connection Test',
    `${SERVICE_URL}/debug/r2-test`
  );
  results.push(r2Test);

  // Test 5: Debug Firestore connection
  const firestoreTest = await testEndpoint(
    'Firestore Connection Test',
    `${SERVICE_URL}/debug/firestore/${TEST_EVENT_ID}`
  );
  results.push(firestoreTest);

  // Test 6: Process photos endpoint (should return 404 for test event with no photos)
  const processTest = await testEndpoint(
    'Process Photos (Expected 404 - No Test Data)',
    `${SERVICE_URL}/process-photos`,
    404,
    'POST',
    {
      eventId: TEST_EVENT_ID,
      email: TEST_EMAIL
    }
  );
  results.push(processTest);

  // Test 7: Process photos with invalid data
  const invalidTest = await testEndpoint(
    'Process Photos - Invalid Input',
    `${SERVICE_URL}/process-photos`,
    400,
    'POST',
    {
      eventId: '',
      email: 'invalid-email'
    }
  );
  results.push(invalidTest);

  // Summary
  log(colors.bold + colors.blue, '\n📊 Test Summary');
  log(colors.blue, '=' .repeat(50));

  const passed = results.filter(r => r.success).length;
  const total = results.length;

  results.forEach((result, index) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const color = result.success ? colors.green : colors.red;
    log(color, `${status} Test ${index + 1}`);
  });

  log(colors.blue, '\n📈 Results:');
  log(colors.green, `✅ Passed: ${passed}/${total}`);
  log(colors.red, `❌ Failed: ${total - passed}/${total}`);

  if (passed === total) {
    log(colors.bold + colors.green, '\n🎉 ALL TESTS PASSED! Your Cloud Run service is working correctly.');
    log(colors.green, '✅ Environment variables are properly configured');
    log(colors.green, '✅ Missing /config-check endpoint has been fixed');
    log(colors.green, '✅ Firestore connection is working');
    log(colors.green, '✅ R2 connection is working');
    log(colors.green, '✅ All endpoints are responding correctly');
  } else {
    log(colors.bold + colors.red, '\n⚠️  SOME TESTS FAILED');
    log(colors.yellow, 'Check the deployment logs and ensure all environment variables are set correctly.');
  }

  // Specific fix validation
  log(colors.bold + colors.blue, '\n🔧 Fix Validation:');
  
  if (configTest.success) {
    log(colors.green, '✅ FIXED: Missing /config-check endpoint');
  } else {
    log(colors.red, '❌ ISSUE: /config-check endpoint still not working');
  }

  if (configTest.success && configTest.response.data.firebase?.configured) {
    log(colors.green, '✅ FIXED: Firebase environment variables');
  } else {
    log(colors.red, '❌ ISSUE: Firebase environment variables not configured');
  }

  if (configTest.success && configTest.response.data.r2?.configured) {
    log(colors.green, '✅ FIXED: R2 environment variables');
  } else {
    log(colors.red, '❌ ISSUE: R2 environment variables not configured');
  }

  if (configTest.success && configTest.response.data.email?.configured) {
    log(colors.green, '✅ FIXED: Email environment variables');
  } else {
    log(colors.red, '❌ ISSUE: Email environment variables not configured');
  }

  log(colors.blue, '\n🚀 Next Steps:');
  log(colors.blue, '1. If all tests pass, your service is ready for production use');
  log(colors.blue, '2. Update your frontend to use the new service URL');
  log(colors.blue, '3. Test with real event data');
  log(colors.blue, `4. Monitor logs at: https://console.cloud.google.com/run/detail/us-west1/wedding-photo-processor/logs`);
}

// Run the tests
if (require.main === module) {
  runAllTests().catch(error => {
    log(colors.red, `\n❌ Test suite failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runAllTests, testEndpoint, makeRequest };
