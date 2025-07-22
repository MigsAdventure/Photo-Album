const axios = require('axios');

async function testDirectEmail() {
  try {
    const emailUrl = 'https://main--sharedmoments.netlify.app/.netlify/functions/direct-email';
    
    const payload = {
      email: process.env.TEST_EMAIL || 'test@example.com',
      downloadUrl: 'https://wedding-photo-spot-1752995104.s3.amazonaws.com/wedding-photos/2025-07-19_234234_alleg2h6/test-photos-1753073116813.zip',
      fileCount: 2,
      finalSizeMB: 0.05
    };
    
    console.log(`Sending test email to: ${payload.email}`);
    console.log(`Download URL: ${payload.downloadUrl}`);
    
    const response = await axios({
      method: 'post',
      url: emailUrl,
      data: payload,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000 // 15 second timeout
    });
    
    console.log(`Response status: ${response.status}`);
    console.log(`Response data:`, response.data);
    
  } catch (error) {
    console.error('Error sending test email:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testDirectEmail();