// Test script to verify the sendUpgradeToGHL function works
const { exec } = require('child_process');

const testData = {
  event_id: "2025-07-15_random_a5skq8xa",
  event_title: "Test Event",
  organizer_email: "test@example.com",
  organizer_name: "Test User",
  plan_type: "premium",
  payment_amount: 29,
  payment_id: "test_payment_123",
  payment_method: "external_form",
  upgrade_timestamp: new Date().toISOString(),
  app_version: "1.0.0",
  source: "wedding_photo_app"
};

console.log('📤 Sending test data to GHL webhook...');
console.log('🎯 Test payload:', JSON.stringify(testData, null, 2));

const GHL_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/OD0oJMJ7R9OatD9liLM0/webhook-trigger/30e7e31b-9e78-4f69-8ecc-4678bd24b45f';

const curlCommand = `curl -X POST "${GHL_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: WeddingPhotoApp/1.0.0" \
  -d '${JSON.stringify(testData)}'`;

exec(curlCommand, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Error testing GHL webhook:', error);
    return;
  }
  
  if (stderr) {
    console.log('📋 Curl stderr:', stderr);
  }
  
  console.log('✅ GHL webhook test completed!');
  console.log('📋 Response:', stdout);
  
  console.log('\n🔍 What should happen next:');
  console.log('1. GHL "Inbound Webhook" trigger should fire');
  console.log('2. GHL workflow should execute with the test data');
  console.log('3. GHL should send webhook back to Netlify with real event data');
  console.log('4. Check GHL Enrollment History for new entry');
});
