const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

async function checkLambdaLogs() {
  const client = new CloudWatchLogsClient({ region: 'us-east-1' });
  
  const logGroupName = '/aws/lambda/wedding-photo-spot-launcher';
  
  console.log('🔍 Checking Lambda logs for wedding-photo-spot-launcher...\n');
  
  try {
    // Get logs from last 2 hours
    const startTime = Date.now() - (2 * 60 * 60 * 1000);
    
    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime,
      limit: 100
    });
    
    const response = await client.send(command);
    
    if (!response.events || response.events.length === 0) {
      console.log('❌ No recent Lambda invocations found in the last 2 hours');
      console.log('\nThis means either:');
      console.log('1. The Lambda is not being triggered from Netlify');
      console.log('2. The download request is not reaching the Lambda');
      console.log('3. There\'s a configuration issue in Netlify');
      return;
    }
    
    console.log(`✅ Found ${response.events.length} log events\n`);
    console.log('Recent Lambda Activity:\n');
    console.log('=' .repeat(80));
    
    response.events.forEach(event => {
      const timestamp = new Date(event.timestamp).toLocaleString();
      console.log(`[${timestamp}] ${event.message}`);
    });
    
    console.log('=' .repeat(80));
    
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      console.log('❌ Lambda log group not found!');
      console.log('This means the Lambda function has never been invoked, or doesn\'t exist.');
    } else {
      console.error('Error checking logs:', error.message);
    }
  }
}

checkLambdaLogs().catch(console.error);
