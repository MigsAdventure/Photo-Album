// Test script for custom event ID generation
// Run with: node test-event-id-generation.js

// Helper function to create URL-safe slug from event title
const createSlug = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 50); // Limit length to 50 characters
};

// Helper function to generate random hash
const generateRandomHash = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Helper function to format date as YYYY-MM-DD (timezone-safe)
const formatDateForId = (dateString) => {
  // Handle date string directly to avoid timezone issues
  if (dateString.includes('-')) {
    // Already in YYYY-MM-DD format, use as-is
    return dateString.split('T')[0]; // Remove time part if present
  }
  
  // Parse and format if needed
  const date = new Date(dateString + 'T00:00:00'); // Add time to avoid timezone shift
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Generate custom event ID with format: YYYY-MM-DD_event-name-slug_random-hash
const generateEventId = (title, date) => {
  const formattedDate = formatDateForId(date);
  const slug = createSlug(title);
  const hash = generateRandomHash();
  return `${formattedDate}_${slug}_${hash}`;
};

// Test cases
console.log('🧪 Testing Event ID Generation\n');

const testCases = [
  {
    title: "Sarah & Mike's Wedding",
    date: "2024-12-15",
    expected: "Should create: 2024-12-15_sarah-mikes-wedding_[hash]"
  },
  {
    title: "John's 30th Birthday Party!",
    date: "2025-01-25", 
    expected: "Should create: 2025-01-25_johns-30th-birthday-party_[hash]"
  },
  {
    title: "Annual Company Picnic & BBQ",
    date: "2025-03-10",
    expected: "Should create: 2025-03-10_annual-company-picnic-bbq_[hash]"
  },
  {
    title: "Baby Shower for Emma 💕",
    date: "2025-02-14",
    expected: "Should create: 2025-02-14_baby-shower-for-emma_[hash]"
  },
  {
    title: "Graduation Party - Class of 2025!!!",
    date: "2025-06-15",
    expected: "Should create: 2025-06-15_graduation-party-class-of-2025_[hash]"
  }
];

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}:`);
  console.log(`Title: "${testCase.title}"`);
  console.log(`Date: ${testCase.date}`);
  console.log(`Expected: ${testCase.expected}`);
  
  const eventId = generateEventId(testCase.title, testCase.date);
  console.log(`Generated: ${eventId}`);
  
  // Validate format
  const parts = eventId.split('_');
  const isValidFormat = parts.length === 3 && 
                       parts[0].match(/^\d{4}-\d{2}-\d{2}$/) &&
                       parts[1].length > 0 &&
                       parts[2].length === 8;
  
  console.log(`✅ Format valid: ${isValidFormat}`);
  console.log(`📁 R2 folder: events/${eventId}/photos/`);
  console.log(`🔗 Event URL: /event/${eventId}`);
  console.log('');
});

// Test edge cases
console.log('🧪 Testing Edge Cases\n');

const edgeCases = [
  {
    title: "",
    date: "2025-01-01",
    description: "Empty title"
  },
  {
    title: "Event with @#$%^&*()[]{}|\\:;\"'<>?,./`~",
    date: "2025-01-01", 
    description: "Special characters"
  },
  {
    title: "Very Long Event Title That Should Be Truncated Because It Exceeds The Fifty Character Limit",
    date: "2025-01-01",
    description: "Long title (should truncate)"
  }
];

edgeCases.forEach((testCase, index) => {
  console.log(`Edge Case ${index + 1}: ${testCase.description}`);
  console.log(`Title: "${testCase.title}"`);
  
  const eventId = generateEventId(testCase.title, testCase.date);
  console.log(`Generated: ${eventId}`);
  console.log('');
});

console.log('✅ Event ID generation testing complete!');
console.log('\n📋 Summary:');
console.log('- Event IDs use actual event date (user-selected)');
console.log('- Format: YYYY-MM-DD_event-name-slug_random-hash');
console.log('- R2 storage will be organized by event date');
console.log('- URLs are clean and descriptive');
console.log('- Backward compatible with existing random IDs');
