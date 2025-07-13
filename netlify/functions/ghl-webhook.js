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
    
    const webhookData = JSON.parse(event.body);
    console.log('📨 Parsed webhook data:', JSON.stringify(webhookData, null, 2));
    
    // Handle your actual GoHighLevel payload format
    if (webhookData.action === 'upgrade_confirmed') {
      console.log('💰 Processing upgrade confirmation webhook');
      
      const { eventId, paymentId, paymentAmount, contactId } = webhookData;
      
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
