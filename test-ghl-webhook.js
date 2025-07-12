// Test script to send sample webhook data to GoHighLevel
// This will populate the "Mapping Reference" dropdown in your GHL workflow

const fetch = require('node-fetch');

const GHL_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/OD0oJMJ7R9OatD9liLM0/webhook-trigger/30e7e31b-9e78-4f69-8ecc-4678bd24b45f';

// Sample data that our app will send when a user upgrades to premium
const sampleWebhookData = {
  event_id: "2024-01-15_wedding_abc123",
  event_title: "Sarah & Mike's Wedding",
  organizer_email: "sarah@example.com", 
  organizer_name: "Sarah Johnson",
  organizer_phone: "+1-555-123-4567",
  plan_type: "premium",
  payment_amount: 29,
  payment_id: "stripe_pi_test123",
  payment_method: "stripe",
  upgrade_timestamp: "2024-01-15T14:30:00Z",
  event_date: "2024-02-14",
  guest_count: 150,
  photo_count: 23,
  // Additional useful fields
  app_version: "1.0.0",
  source: "mobile_app",
  previous_plan: "free"
};

async function sendTestWebhook() {
  console.log('🚀 Sending test webhook to GoHighLevel...');
  console.log('📍 URL:', GHL_WEBHOOK_URL);
  console.log('📦 Data:', JSON.stringify(sampleWebhookData, null, 2));
  
  try {
    const response = await fetch(GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WeddingPhotoApp/1.0.0'
      },
      body: JSON.stringify(sampleWebhookData)
    });

    console.log('\n📊 Response Status:', response.status);
    console.log('📊 Response Status Text:', response.statusText);
    
    const responseText = await response.text();
    console.log('📊 Response Body:', responseText);

    if (response.ok) {
      console.log('\n✅ SUCCESS! Test webhook sent successfully!');
      console.log('\n📋 Next Steps:');
      console.log('1. Go back to your GoHighLevel workflow page');
      console.log('2. Refresh the page');
      console.log('3. Click "Check for new requests" in the Mapping Reference dropdown');
      console.log('4. Select the sample payload we just sent');
      console.log('5. Save the trigger');
      console.log('6. Add your workflow actions (update contact, send email, etc.)');
    } else {
      console.log('\n❌ Error sending webhook');
      console.log('Status:', response.status, response.statusText);
    }

  } catch (error) {
    console.error('\n❌ Failed to send test webhook:', error.message);
  }
}

// Run the test
sendTestWebhook();
