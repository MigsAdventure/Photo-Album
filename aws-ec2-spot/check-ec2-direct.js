const axios = require('axios');

async function checkEC2Health() {
  try {
    console.log('Checking EC2 instance health...');
    const response = await axios.get('http://3.91.55.208:8080/health', { timeout: 5000 });
    console.log('Health check response:');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('Error checking EC2 health:', error.message);
    return false;
  }
}

async function checkEC2Logs() {
  try {
    console.log('\nChecking EC2 instance logs...');
    const response = await axios.get('http://3.91.55.208:8080/logs', { timeout: 5000 });
    console.log('Logs:');
    console.log(response.data);
  } catch (error) {
    console.error('Error checking EC2 logs:', error.message);
  }
}

async function sendTestRequest() {
  try {
    console.log('\nSending test request to EC2 instance...');
    const response = await axios.post('http://3.91.55.208:8080/process', {
      eventId: '2025-07-25_23r423_8xron6po',
      email: 'migsub77@gmail.com',
      photos: [
        { fileName: 'test-photo1.jpg', url: 'https://picsum.photos/800/600', size: 500000 },
        { fileName: 'test-photo2.jpg', url: 'https://picsum.photos/800/601', size: 500000 }
      ]
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error sending test request:', error.message);
  }
}

async function run() {
  const isHealthy = await checkEC2Health();
  
  if (isHealthy) {
    await checkEC2Logs();
    await sendTestRequest();
    
    // Check logs again after sending the request
    console.log('\nWaiting 3 seconds for logs to update...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await checkEC2Logs();
  }
}

run();