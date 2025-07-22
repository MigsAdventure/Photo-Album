const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

// Initialize CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });

async function searchForEventInLogs(eventId) {
  try {
    // Lambda function name - this is the EC2 launcher Lambda
    const functionName = 'wedding-photo-ec2-launcher';
    
    console.log(`Searching for event ID "${eventId}" in Lambda logs...`);
    
    const logGroupName = `/aws/lambda/${functionName}`;
    
    // Get logs from the last day
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - 24);
    
    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime: startTime.getTime(),
      filterPattern: eventId,
      limit: 100
    });
    
    const response = await logsClient.send(command);
    
    if (response.events && response.events.length > 0) {
      console.log(`Found ${response.events.length} log events containing event ID "${eventId}":`);
      response.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        console.log(`[${timestamp}] ${event.message}`);
      });
      return true;
    } else {
      console.log(`No log events found containing event ID "${eventId}"`);
      return false;
    }
  } catch (error) {
    console.error(`Error searching for event ID "${eventId}" in logs:`, error);
    return false;
  }
}

// Also check recent Lambda invocations
async function checkRecentInvocations() {
  try {
    const functionName = 'wedding-photo-ec2-launcher';
    console.log(`\nChecking recent invocations of Lambda function: ${functionName}`);
    
    const logGroupName = `/aws/lambda/${functionName}`;
    
    // Get recent REPORT logs which indicate Lambda executions
    const command = new FilterLogEventsCommand({
      logGroupName,
      filterPattern: 'REPORT',
      limit: 10
    });
    
    const response = await logsClient.send(command);
    
    if (response.events && response.events.length > 0) {
      console.log(`Found ${response.events.length} recent Lambda invocations:`);
      response.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        console.log(`[${timestamp}] ${event.message}`);
      });
      
      // Extract request IDs to get more details
      const requestIds = response.events.map(event => {
        const match = event.message.match(/RequestId: ([0-9a-f-]+)/);
        return match ? match[1] : null;
      }).filter(id => id);
      
      // Get detailed logs for each request ID
      for (const requestId of requestIds) {
        console.log(`\nGetting details for request ID: ${requestId}`);
        
        const detailCommand = new FilterLogEventsCommand({
          logGroupName,
          filterPattern: requestId,
          limit: 50
        });
        
        const detailResponse = await logsClient.send(detailCommand);
        
        if (detailResponse.events && detailResponse.events.length > 0) {
          detailResponse.events.forEach(event => {
            const timestamp = new Date(event.timestamp).toISOString();
            console.log(`[${timestamp}] ${event.message}`);
          });
        }
      }
    } else {
      console.log('No recent Lambda invocations found');
    }
  } catch (error) {
    console.error('Error checking recent Lambda invocations:', error);
  }
}

async function runChecks() {
  const eventId = "2025-07-25_23r423_8xron6po";
  const found = await searchForEventInLogs(eventId);
  
  if (!found) {
    console.log("\nEvent ID not found. Checking recent Lambda invocations...");
    await checkRecentInvocations();
  }
}

runChecks();