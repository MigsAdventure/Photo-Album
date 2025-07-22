const axios = require('axios');

async function checkEC2Health() {
  try {
    const instanceIP = '54.210.124.127';
    const healthEndpoint = `http://${instanceIP}:8080/health`;
    
    console.log(`Checking EC2 instance health at: ${healthEndpoint}`);
    
    const response = await axios.get(healthEndpoint, { timeout: 5000 });
    
    console.log('Health check response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    return response.data.status === 'healthy';
  } catch (error) {
    console.error('Error checking EC2 health:', error.message);
    return false;
  }
}

async function sendTestProcessingRequest() {
  try {
    const instanceIP = '54.210.124.127';
    const processEndpoint = `http://${instanceIP}:8080/process`;
    
    const testData = {
      eventId: '2025-07-25_23r423_8xron6po',
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
    
    console.log(`Sending test processing request to: ${processEndpoint}`);
    console.log('Test data:', JSON.stringify(testData, null, 2));
    
    const response = await axios.post(processEndpoint, testData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('Processing request response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    return true;
  } catch (error) {
    console.error('Error sending processing request:', error.message);
    return false;
  }
}

async function run() {
  const isHealthy = await checkEC2Health();
  
  if (isHealthy) {
    console.log('✅ EC2 instance is healthy. Sending test processing request...');
    await sendTestProcessingRequest();
  } else {
    console.log('❌ EC2 instance is not healthy. Cannot send processing request.');
  }
}

run();