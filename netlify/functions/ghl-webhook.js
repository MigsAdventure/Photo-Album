const admin = require('firebase-admin');

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

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

      // Get the event document
      const eventRef = db.collection('events').doc(eventId);
      const eventDoc = await eventRef.get();
      
      if (!eventDoc.exists) {
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

      // Upgrade event to premium
      await eventRef.update({
        planType: 'premium',
        paymentId: orderId,
        photoLimit: -1, // Unlimited
        upgradedAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentAmount: amount || 29
      });

      console.log('✅ Event upgraded to premium:', eventId);

      // Optional: Send upgrade confirmation email
      try {
        const eventData = eventDoc.data();
        if (eventData.organizerEmail) {
          console.log('📧 Sending upgrade confirmation email to:', eventData.organizerEmail);
          
          // This could be enhanced to send a confirmation email
          // For now, we'll just log it
          console.log('✅ Upgrade confirmation would be sent here');
        }
      } catch (emailError) {
        console.error('📧 Failed to send upgrade confirmation:', emailError);
        // Don't fail the whole webhook for email issues
      }

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
