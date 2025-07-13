const fetch = require('node-fetch');

async function testNewPayload() {
  console.log('🧪 Testing with your exact GoHighLevel payload format...');
  
  const webhookUrl = 'https://develop--sharedmoments.netlify.app/.netlify/functions/ghl-webhook';
  
  // Your exact payload format with test data
  const testPayload = {
    "action": "upgrade_confirmed",
    "eventId": "2025-07-13_test-new-event_abc123",
    "eventTitle": "Test New Event",
    "organizerEmail": "test@example.com",
    "organizerName": "Test User",
    "planType": "premium",
    "paymentAmount": 29,
    "paymentId": "contact_123_payment_456",
    "paymentMethod": "ghl_form",
    "contactId": "contact_123",
    "upgradeTimestamp": "2025-07-13T16:30:00Z"
  };

  try {
    console.log('📦 Sending payload to:', webhookUrl);
    console.log('📄 Payload:', JSON.stringify(testPayload, null, 2));
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload)
    });

    console.log('📊 Response Status:', response.status);
    console.log('📊 Response Status Text:', response.statusText);
    
    const responseText = await response.text();
    console.log('📊 Response Body:', responseText);

    if (response.ok) {
      console.log('✅ SUCCESS! Webhook processed with new payload format!');
    } else {
      console.log('❌ FAILED! Check the response for errors.');
    }

  } catch (error) {
    console.error('❌ ERROR calling webhook:', error.message);
  }
}

testNewPayload();
