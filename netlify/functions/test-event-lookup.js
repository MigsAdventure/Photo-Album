// Test function to help debug event lookup issues
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin if not already initialized
let app;
try {
  app = initializeApp();
} catch (error) {
  // App already initialized
  const { getApp } = require('firebase-admin/app');
  app = getApp();
}

const db = getFirestore();

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const eventId = event.queryStringParameters?.eventId;
    
    if (!eventId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'No eventId provided',
          received: event.queryStringParameters
        })
      };
    }

    console.log('🔍 Looking up event:', eventId);

    // Try to get the event from Firestore
    const eventDoc = await db.collection('events').doc(eventId).get();
    
    if (!eventDoc.exists) {
      console.log('❌ Event not found in Firestore:', eventId);
      
      // List all events to see what exists
      const eventsSnapshot = await db.collection('events').limit(10).get();
      const existingEvents = [];
      eventsSnapshot.forEach(doc => {
        existingEvents.push({
          id: doc.id,
          data: doc.data()
        });
      });
      
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'Event not found',
          searchedId: eventId,
          existingEvents: existingEvents,
          totalEvents: eventsSnapshot.size
        })
      };
    }

    const eventData = {
      id: eventDoc.id,
      ...eventDoc.data()
    };

    console.log('✅ Event found:', eventData);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        event: eventData,
        searchedId: eventId
      })
    };

  } catch (error) {
    console.error('❌ Test event lookup error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};
