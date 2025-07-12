const fetch = require('node-fetch');

async function testNetlifyWebhook() {
  console.log('🧪 Testing Netlify webhook function...');
  
  const webhookUrl = 'https://develop--sharedmoments.netlify.app/.netlify/functions/ghl-webhook';
  
  const testPayload = {
    type: 'order.completed',
    data: {
      orderId: 'stripe_test_12345',
      contactId: 'contact_test_123',
      amount: 29,
      customFields: {
        event_id: '2025-07-13_payment-test-5_64240jxm',
        event_title: 'payment-test-5',
        organizer_email: 'test@example.com'
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
    } else {
      console.log('❌ FAILED! Webhook returned error.');
    }

  } catch (error) {
    console.error('❌ ERROR calling webhook:', error.message);
  }
}

testNetlifyWebhook();
