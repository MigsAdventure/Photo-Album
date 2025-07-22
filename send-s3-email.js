const axios = require('axios');

async function sendS3Email() {
  try {
    const emailUrl = 'https://main--sharedmoments.netlify.app/.netlify/functions/direct-email';
    
    // Create a test S3 URL for the event
    const eventId = '2025-07-25_23r423_8xron6po';
    const s3Url = `https://wedding-photo-spot-1752995104.s3.amazonaws.com/wedding-photos/${eventId}/test-file-${Date.now()}.zip`;
    
    const payload = {
      email: 'migsub77@gmail.com',
      downloadUrl: s3Url,
      fileCount: 4,
      finalSizeMB: 241.85
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

sendS3Email();