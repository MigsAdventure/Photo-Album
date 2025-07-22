const axios = require('axios');

async function launchNewInstance() {
  try {
    const lambdaUrl = 'https://szfs7ixxp34s6nbeonngs726om0ihnqx.lambda-url.us-east-1.on.aws/';
    const eventId = '2025-07-25_23r423_8xron6po';
    
    console.log(`Launching new EC2 instance to process event: ${eventId}`);
    
    // This is a minimal payload to trigger the Lambda function
    // The Lambda will then fetch the full data from Firestore
    const payload = {
      eventId: eventId,
      email: 'migsub77@gmail.com',
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
    
    console.log('Sending request to Lambda function...');
    const response = await axios.post(lambdaUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    
    console.log('Lambda response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.instanceId) {
      console.log(`\n✅ New EC2 instance launched: ${response.data.instanceId}`);
      console.log(`✅ Public IP: ${response.data.publicIP || 'N/A'}`);
      console.log(`⏳ Estimated processing time: ${response.data.processingTime || '2-3 minutes'}`);
      console.log(`💰 Estimated cost: ${response.data.estimatedCost || '$0.01-0.02'}`);
      
      // Wait a bit for the instance to start up
      console.log('\nWaiting 30 seconds for the instance to start up...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Check if the instance is up
      if (response.data.publicIP) {
        try {
          console.log(`Checking if instance is up at http://${response.data.publicIP}:8080/health...`);
          const healthResponse = await axios.get(`http://${response.data.publicIP}:8080/health`, { timeout: 5000 });
          console.log('Health check response:');
          console.log(JSON.stringify(healthResponse.data, null, 2));
        } catch (error) {
          console.log(`❌ Health check failed: ${error.message}`);
          console.log('This is normal if the instance is still starting up.');
        }
      }
      
      console.log('\n⏳ The instance will now process your event. Check your email in 2-5 minutes.');
    } else {
      console.log('❌ Failed to launch new EC2 instance');
    }
    
  } catch (error) {
    console.error('Error launching new EC2 instance:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

launchNewInstance();