// Quick test to reset an event back to free for testing
const eventId = '2025-07-15_random_a5skq8xa';

const resetEvent = async () => {
  try {
    const response = await fetch(`https://sharedmoments.netlify.app/.netlify/functions/ghl-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'reset_to_free', // We'll need to add this action to the webhook
        eventId: eventId
      })
    });
    
    const result = await response.json();
    console.log('Reset result:', result);
  } catch (error) {
    console.error('Reset failed:', error);
  }
};

resetEvent();
