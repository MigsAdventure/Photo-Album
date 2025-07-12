const fetch = require('node-fetch');

// Test with a real event ID that you'll provide
async function testRealWebhook(realEventId) {
  if (!realEventId) {
    console.log('❌ Please provide a real event ID');
    console.log('Usage: node test-real-webhook.js YOUR_EVENT_ID');
    return;
  }

  console.log('🧪 Testing webhook with real event ID:', realEventId);
  
  const webhookUrl = 'https://develop--sharedmoments.netlify.app/.netlify/functions/ghl-webhook';
  
  // Test payload that simulates what GoHighLevel might send
  const testPayload = {
    type: 'order.completed',
    data: {
      orderId: 'real_order_' + Date.now(),
      contactId: 'real_contact_' + Date.now(),
      amount: 29,
      customFields: {
        event_id: realEventId,
        event_title: 'Real Test Event',
        organizer_email: 'real@example.com'
      }
    }
  };

  try {
    console.log('📦 Sending test payload to:', webhookUrl);
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
      console.log('✅ SUCCESS! Webhook processed successfully!');
      console.log('🔍 Now check your app to see if the event was upgraded to premium');
    } else {
      console.log('❌ FAILED! Webhook returned error.');
    }

  } catch (error) {
    console.error('❌ ERROR calling webhook:', error.message);
  }
}

// Get event ID from command line arguments
const eventId = process.argv[2];
testRealWebhook(eventId);
