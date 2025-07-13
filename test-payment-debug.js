// Test localStorage and event lookup functionality
// Run this in browser console to debug payment issues

console.log('🔍 DEBUGGING PAYMENT CONFIRMATION ISSUES');

// Test 1: Check if localStorage has pending upgrade data
const pendingUpgrade = localStorage.getItem('pendingUpgrade');
console.log('📦 localStorage pendingUpgrade:', pendingUpgrade);

if (pendingUpgrade) {
  try {
    const upgradeData = JSON.parse(pendingUpgrade);
    console.log('✅ Parsed upgrade data:', upgradeData);
    
    const isRecent = upgradeData.timestamp && (Date.now() - upgradeData.timestamp < 3600000);
    console.log('⏰ Is data recent (< 1 hour)?', isRecent);
    console.log('🕐 Data age (minutes):', upgradeData.timestamp ? (Date.now() - upgradeData.timestamp) / 1000 / 60 : 'No timestamp');
    
    if (upgradeData.eventId) {
      console.log('🎯 Event ID from localStorage:', upgradeData.eventId);
    }
  } catch (error) {
    console.error('❌ Failed to parse localStorage data:', error);
  }
} else {
  console.log('⚠️ No pendingUpgrade data in localStorage');
}

// Test 2: Check URL parameters
const urlParams = new URLSearchParams(window.location.search);
const eventIdFromUrl = urlParams.get('event_id');
console.log('🔗 Event ID from URL:', eventIdFromUrl);

// Test 3: Check Firebase connection and event lookup
async function testEventLookup(eventId) {
  if (!eventId) {
    console.log('❌ No event ID to test');
    return;
  }
  
  console.log('🔍 Testing event lookup for ID:', eventId);
  
  try {
    // Import the getEvent function (this might need to be adjusted based on your setup)
    const response = await fetch(`/.netlify/functions/test-event-lookup?eventId=${eventId}`);
    const data = await response.json();
    console.log('📊 Event lookup result:', data);
  } catch (error) {
    console.error('❌ Event lookup failed:', error);
  }
}

// Test 4: Create a mock localStorage entry to test
function createTestUpgrade(eventId = 'test-event-123') {
  const testData = {
    eventId: eventId,
    eventTitle: 'Test Event',
    organizerEmail: 'test@example.com',
    timestamp: Date.now(),
    paymentAmount: 29
  };
  
  localStorage.setItem('pendingUpgrade', JSON.stringify(testData));
  console.log('✅ Created test localStorage data:', testData);
}

// Run initial tests
console.log('📍 Current URL:', window.location.href);
console.log('📍 Current search params:', window.location.search);

// Suggest next steps
console.log('\n🔧 DEBUG STEPS:');
console.log('1. Run createTestUpgrade() to create test data');
console.log('2. Check if localStorage is working');
console.log('3. Verify event exists in Firebase');
console.log('4. Check browser network requests');

// Export functions for manual testing
window.createTestUpgrade = createTestUpgrade;
window.testEventLookup = testEventLookup;
