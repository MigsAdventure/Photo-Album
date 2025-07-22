const fetch = require('node-fetch');

async function checkNetlifyLogs() {
  try {
    // This is a simplified example - in a real scenario, you would need to authenticate with Netlify API
    console.log('To check Netlify function logs, you would need to:');
    console.log('1. Log in to the Netlify dashboard');
    console.log('2. Go to your site (sharedmoments)');
    console.log('3. Navigate to Functions > email-download');
    console.log('4. Check the logs for recent invocations');
    
    // As an alternative, we can check if the function is accessible
    console.log('\nChecking if the Netlify function is accessible...');
    
    const response = await fetch('https://main--sharedmoments.netlify.app/.netlify/functions/email-download', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Response status: ${response.status}`);
    if (response.status === 405) {
      console.log('Function is accessible but requires POST method (expected behavior)');
    } else {
      console.log('Unexpected response from function');
    }
    
  } catch (error) {
    console.error('Error checking Netlify function:', error);
  }
}

checkNetlifyLogs();