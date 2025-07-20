/**
 * Test 80MB File Filtering - Core System Test
 * This will test processing 8 files under 80MB and confirm the 200MB video is deferred
 */

const eventId = `event_2025-07-19_${Date.now().toString().slice(-6)}_alleg2h6`;
const requestId = `r${Math.random().toString(36).substr(2, 9)}`;

// Test data - mix of files under 80MB (should process) and 200MB video (should defer)
const testPhotos = [
  {
    fileName: "ChatGPT Image May 9, 2025, 09_54_16 PM.png",
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/ChatGPT%20Image%20May%209%2C%202025%2C%2009_54_16%20PM.png",
    size: 2545836  // 2.43MB - SHOULD PROCESS
  },
  {
    fileName: "SampleVideo_720x480_30mb.mp4", 
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/SampleVideo_720x480_30mb.mp4",
    size: 31551484  // 30.09MB - SHOULD PROCESS
  },
  {
    fileName: "SampleVideo_720x480_30mb.mp4",
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/SampleVideo_720x480_30mb.mp4", 
    size: 31551484  // 30.09MB - SHOULD PROCESS (duplicate test)
  },
  {
    fileName: "ChatGPT Image May 4, 2025, 04_02_17 PM.png",
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/ChatGPT%20Image%20May%204%2C%202025%2C%2004_02_17%20PM.png",
    size: 2073949  // 1.98MB - SHOULD PROCESS
  },
  {
    fileName: "SampleVideo_1280x720_5mb.mp4",
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/SampleVideo_1280x720_5mb.mp4", 
    size: 5253880  // 5.01MB - SHOULD PROCESS
  },
  {
    fileName: "perler-light-lavender-80-15182_c6faf577-3ebd-4025-8d72-43cab6f24f12_1296x1296 (1).jpg",
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/perler-light-lavender-80-15182_c6faf577-3ebd-4025-8d72-43cab6f24f12_1296x1296%20(1).jpg",
    size: 48013  // 0.05MB - SHOULD PROCESS
  },
  {
    fileName: "ChatGPT Image May 4, 2025, 03_58_02 PM.png", 
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/ChatGPT%20Image%20May%204%2C%202025%2C%2003_58_02%20PM.png",
    size: 1791677  // 1.71MB - SHOULD PROCESS
  },
  {
    fileName: "Gabs Delights Business Card.png",
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/Gabs%20Delights%20Business%20Card.png", 
    size: 2706772  // 2.58MB - SHOULD PROCESS
  },
  {
    fileName: "200MB_1080P_THETESTDATA.COM_mp4.mp4",
    url: "https://r2.sharedmoments.xyz/event-uploads/event_2025-07-19_234234_alleg2h6/200MB_1080P_THETESTDATA.COM_mp4.mp4",
    size: 210207254  // 200.47MB - SHOULD DEFER (>80MB limit)
  }
];

console.log('🧪 Testing 80MB File Filtering System');
console.log(`📊 Test Data: ${testPhotos.length} total files`);
console.log(`   - 8 files ≤80MB (should process immediately)`);
console.log(`   - 1 file >80MB (should defer for separate processing)`);
console.log(`📧 Test Email: migsub77@gmail.com`);
console.log(`🔄 Request ID: ${requestId}`);
console.log(`📅 Event ID: ${eventId}`);

const payload = {
  eventId,
  email: 'migsub77@gmail.com',
  photos: testPhotos,
  requestId
};

console.log('\n🚀 Sending request to Cloudflare Worker...');

fetch('https://sharedmoments-photo-processor.migsub77.workers.dev/process-zip', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload)
})
.then(response => response.json())
.then(data => {
  console.log('\n✅ Response received:');
  console.log(JSON.stringify(data, null, 2));
  
  if (data.success) {
    console.log('\n🎯 Expected Behavior:');
    console.log('✅ Processing should start immediately');
    console.log('✅ 8 files should be processed in ZIP');
    console.log('✅ 200MB video should be deferred');
    console.log('✅ Email should arrive with ZIP download');
    console.log('✅ Email should mention deferred large file');
    console.log('\n⏰ Expected timing: 2-3 minutes for email delivery');
  }
})
.catch(error => {
  console.error('\n❌ Request failed:', error);
});
