const axios = require('axios');

async function sendDirectEmail() {
  console.log('Sending direct email with download link...');
  
  const netlifyUrl = 'https://main--sharedmoments.netlify.app/.netlify/functions/direct-email';
  const payload = {
    email: 'migsub77@gmail.com', // Your email
    downloadUrl: 'https://wedding-photo-spot-1752995104.s3.amazonaws.com/wedding-photos/2025-07-19_234234_alleg2h6/test-download.zip',
    fileCount: 10, // Adjust as needed
    finalSizeMB: 250, // Adjust as needed
    requestId: 'manual-test-' + Date.now()
  };
  
  try {
    const response = await axios({
      method: 'post',
      url: netlifyUrl,
      data: payload,
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
    
    return { status: response.status, data: response.data };
  } catch (error) {
    console.error('Error sending email notification:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

sendDirectEmail()
  .then(result => {
    console.log('Email sent successfully with status code:', result.status);
  })
  .catch(error => {
    console.error('Failed to send email');
  });