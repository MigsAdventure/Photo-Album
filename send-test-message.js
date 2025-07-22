const fetch = require('node-fetch');

async function sendTestMessage() {
  try {
    const lambdaUrl = 'https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/';
    
    const testData = {
      eventId: `test-${Date.now()}`,
      email: process.env.TEST_EMAIL || 'test@example.com',
      photos: [
        {
          fileName: 'test-photo1.jpg',
          url: 'https://picsum.photos/800/600',
          size: 500000
        },
        {
          fileName: 'test-photo2.jpg',
          url: 'https://picsum.photos/800/601',
          size: 500000
        }
      ]
    };
    
    console.log(`Sending test message to Lambda function: ${lambdaUrl}`);
    console.log(`Test data: ${JSON.stringify(testData, null, 2)}`);
    
    const response = await fetch(lambdaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });
    
    const responseData = await response.json();
    console.log(`Response status: ${response.status}`);
    console.log(`Response data: ${JSON.stringify(responseData, null, 2)}`);
    
  } catch (error) {
    console.error('Error sending test message:', error);
  }
}

sendTestMessage();