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
    console.log('📨 GHL Webhook received - Raw body:', event.body);
    console.log('📨 GHL Webhook headers:', JSON.stringify(event.headers, null, 2));
    
    // Log ALL incoming data for debugging real GHL payloads
    console.log('🔍 FULL EVENT OBJECT:', JSON.stringify(event, null, 2));
    
    const webhookData = JSON.parse(event.body);
    console.log('📨 Parsed webhook data:', JSON.stringify(webhookData, null, 2));
    
    // Check all possible webhook data fields
    console.log('🔍 Available fields in webhook:', Object.keys(webhookData));
    
    // Handle your actual GoHighLevel payload format
    if (webhookData.action === 'upgrade_confirmed') {
      console.log('💰 Processing upgrade confirmation webhook');
      
      // GHL sends template variables like {{inboundWebhookRequest.event_id}}
      // We need to extract the actual values from the webhook data
      let { eventId, paymentId, paymentAmount, contactId } = webhookData;
      
      console.log('📋 Raw webhook fields:', { eventId, paymentId, paymentAmount, contactId });
      
      // Check if we got template variables instead of actual values
      if (eventId && eventId.includes('{{')) {
        console.log('🔍 Template variables detected, looking for actual values...');
        
        // Look for the actual data in the webhook request
        // GHL might send the real data in different fields
        const possibleEventIds = [
          webhookData.event_id,
          webhookData.eventId,
          event.queryStringParameters?.event_id,
          event.queryStringParameters?.eventId
        ].filter(Boolean);
        
        const possiblePaymentIds = [
          webhookData.payment_id,
          webhookData.paymentId,
          event.queryStringParameters?.payment_id,
          event.queryStringParameters?.paymentId
        ].filter(Boolean);
        
        console.log('🔍 Possible event IDs found:', possibleEventIds);
        console.log('🔍 Possible payment IDs found:', possiblePaymentIds);
        
        // Use the first valid looking event ID
        eventId = possibleEventIds.find(id => id && !id.includes('{{')) || eventId;
        paymentId = possiblePaymentIds.find(id => id && !id.includes('{{')) || paymentId;
      }
      
      console.log('📋 Final extracted values:', { eventId, paymentId, paymentAmount, contactId });
      
      if (!eventId || eventId.includes('{{')) {
        console.log('❌ No valid event ID found in webhook');
        console.log('❌ Available webhook keys:', Object.keys(webhookData));
        console.log('❌ Available query params:', event.queryStringParameters);
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ 
            error: 'Event ID required', 
            received: eventId,
            availableFields: Object.keys(webhookData)
          }),
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

      // Get current event data first
      const eventData = await getResponse.json();
      console.log('📊 Current event data:', JSON.stringify(eventData, null, 2));

      // Update the event to premium using REST API
      const updateData = {
        fields: {
          planType: { stringValue: 'premium' },
          paymentId: { stringValue: paymentId || 'manual_test' },
          photoLimit: { integerValue: -1 }, // Unlimited
          upgradedAt: { timestampValue: new Date().toISOString() },
          paymentAmount: { integerValue: paymentAmount || 29 }
        }
      };

      console.log('🔄 Attempting Firebase update with data:', JSON.stringify(updateData, null, 2));
      console.log('🔗 Firebase URL:', `${firestoreUrl}?updateMask.fieldPaths=planType&updateMask.fieldPaths=paymentId&updateMask.fieldPaths=photoLimit&updateMask.fieldPaths=upgradedAt&updateMask.fieldPaths=paymentAmount&key=${FIREBASE_API_KEY ? 'API_KEY_PRESENT' : 'API_KEY_MISSING'}`);

      const updateResponse = await fetch(`${firestoreUrl}?updateMask.fieldPaths=planType&updateMask.fieldPaths=paymentId&updateMask.fieldPaths=photoLimit&updateMask.fieldPaths=upgradedAt&updateMask.fieldPaths=paymentAmount&key=${FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });

      console.log('📡 Firebase response status:', updateResponse.status);
      
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('❌ Failed to update event - Status:', updateResponse.status);
        console.error('❌ Failed to update event - Error:', errorText);
        console.error('❌ Firebase Project ID:', FIREBASE_PROJECT_ID);
        console.error('❌ Firebase API Key present:', !!FIREBASE_API_KEY);
        
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ 
            error: 'Failed to upgrade event',
            details: errorText,
            status: updateResponse.status,
            eventId: eventId,
            firebaseProject: FIREBASE_PROJECT_ID
          }),
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
          paymentId 
        }),
      };
    }

    // Handle reset to free for testing
    if (webhookData.action === 'reset_to_free') {
      console.log('🔄 Processing reset to free webhook');
      
      const { eventId } = webhookData;
      
      if (!eventId) {
        console.log('❌ No event ID found in reset webhook');
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ error: 'Event ID required' }),
        };
      }

      // Use Firebase REST API to reset the event
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/events/${eventId}`;
      
      // Update the event back to free using REST API
      const updateData = {
        fields: {
          planType: { stringValue: 'free' },
          photoLimit: { integerValue: 2 }, // Back to 2 photo limit
          resetAt: { timestampValue: new Date().toISOString() }
        }
      };

      const updateResponse = await fetch(`${firestoreUrl}?updateMask.fieldPaths=planType&updateMask.fieldPaths=photoLimit&updateMask.fieldPaths=resetAt&key=${FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('❌ Failed to reset event:', errorText);
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ error: 'Failed to reset event' }),
        };
      }

      console.log('✅ Event reset to free:', eventId);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ 
          success: true, 
          message: 'Event reset to free',
          eventId
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
