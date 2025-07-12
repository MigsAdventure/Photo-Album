// Simple Firebase REST API approach (no admin SDK needed)
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'wedding-photo-240c9';
const FIREBASE_API_KEY = process.env.REACT_APP_FIREBASE_API_KEY;

// GoHighLevel webhook handler for payment processing
exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    console.log('📨 GHL Webhook received:', event.body);
    
    const webhookData = JSON.parse(event.body);
    
    // Verify webhook is from GoHighLevel (basic validation)
    if (!webhookData.type || !webhookData.data) {
      console.log('❌ Invalid webhook format');
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ error: 'Invalid webhook format' }),
      };
    }

    // Handle order completion (payment successful)
    if (webhookData.type === 'order.completed') {
      console.log('💰 Processing order completion webhook');
      
      const { orderId, contactId, customFields, amount } = webhookData.data;
      const eventId = customFields?.event_id;
      
      if (!eventId) {
        console.log('❌ No event ID found in webhook');
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ error: 'Event ID required' }),
        };
      }

      // Use Firebase REST API to update the event
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/events/${eventId}`;
      
      console.log('🔍 Getting event from Firestore:', eventId);
      
      // First, get the current event document
      const getResponse = await fetch(`${firestoreUrl}?key=${FIREBASE_API_KEY}`);
      
      if (!getResponse.ok) {
        console.log('❌ Event not found:', eventId);
        return {
          statusCode: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ error: 'Event not found' }),
        };
      }

      // Update the event to premium using REST API
      const updateData = {
        fields: {
          planType: { stringValue: 'premium' },
          paymentId: { stringValue: orderId },
          photoLimit: { integerValue: -1 }, // Unlimited
          upgradedAt: { timestampValue: new Date().toISOString() },
          paymentAmount: { integerValue: amount || 29 }
        }
      };

      const updateResponse = await fetch(`${firestoreUrl}?updateMask.fieldPaths=planType&updateMask.fieldPaths=paymentId&updateMask.fieldPaths=photoLimit&updateMask.fieldPaths=upgradedAt&updateMask.fieldPaths=paymentAmount&key=${FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('❌ Failed to update event:', errorText);
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ error: 'Failed to upgrade event' }),
        };
      }

      console.log('✅ Event upgraded to premium:', eventId);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ 
          success: true, 
          message: 'Event upgraded to premium',
          eventId,
          orderId 
        }),
      };
    }

    // Handle other webhook types (for future expansion)
    console.log(`🔄 Unhandled webhook type: ${webhookData.type}`);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ 
        success: true, 
        message: 'Webhook received but not processed',
        type: webhookData.type 
      }),
    };

  } catch (error) {
    console.error('❌ GHL Webhook processing failed:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ 
        error: 'Webhook processing failed',
        details: error.message 
      }),
    };
  }
};
