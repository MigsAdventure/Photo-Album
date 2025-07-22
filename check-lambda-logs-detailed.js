const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

// Initialize CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });

async function checkLambdaLogs() {
  try {
    // Lambda function name - replace with your actual function name
    const functionName = 'wedding-photo-ec2-launcher';
    
    console.log(`Checking CloudWatch logs for Lambda function: ${functionName}`);
    
    const logGroupName = `/aws/lambda/${functionName}`;
    
    // Get logs from the last hour
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - 1);
    
    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime: startTime.getTime(),
      limit: 100,
      filterPattern: 'REPORT' // This will show execution reports
    });
    
    console.log(`Fetching logs since: ${startTime.toISOString()}`);
    const response = await logsClient.send(command);
    
    if (response.events && response.events.length > 0) {
      console.log(`Found ${response.events.length} log events:`);
      
      // Group by request ID to see complete executions
      const requestGroups = {};
      
      response.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        console.log(`[${timestamp}] ${event.message}`);
        
        // Extract request ID if possible
        const requestIdMatch = event.message.match(/RequestId: ([0-9a-f-]+)/);
        if (requestIdMatch && requestIdMatch[1]) {
          const requestId = requestIdMatch[1];
          if (!requestGroups[requestId]) {
            requestGroups[requestId] = [];
          }
          requestGroups[requestId].push(event);
        }
      });
      
      // Now let's get more detailed logs for each request
      console.log("\nFetching detailed logs for each request ID...");
      
      for (const requestId in requestGroups) {
        console.log(`\n--- Request ID: ${requestId} ---`);
        
        const detailCommand = new FilterLogEventsCommand({
          logGroupName,
          filterPattern: requestId,
          startTime: startTime.getTime(),
          limit: 100
        });
        
        const detailResponse = await logsClient.send(detailCommand);
        
        if (detailResponse.events && detailResponse.events.length > 0) {
          detailResponse.events.forEach(event => {
            const timestamp = new Date(event.timestamp).toISOString();
            console.log(`[${timestamp}] ${event.message}`);
          });
        } else {
          console.log("No detailed logs found for this request ID");
        }
      }
      
    } else {
      console.log('No log events found in the specified time range');
      
      // Try looking for any recent invocations
      console.log('\nChecking for any recent invocations...');
      
      const anyLogsCommand = new FilterLogEventsCommand({
        logGroupName,
        limit: 10
      });
      
      const anyLogsResponse = await logsClient.send(anyLogsCommand);
      
      if (anyLogsResponse.events && anyLogsResponse.events.length > 0) {
        console.log(`Found ${anyLogsResponse.events.length} most recent log events:`);
        anyLogsResponse.events.forEach(event => {
          const timestamp = new Date(event.timestamp).toISOString();
          console.log(`[${timestamp}] ${event.message}`);
        });
      } else {
        console.log('No log events found at all');
      }
    }
  } catch (error) {
    console.error('Error checking Lambda logs:', error);
  }
}

// Also check for specific event patterns
async function searchForEventInLogs(eventId) {
  try {
    // Lambda function name - replace with your actual function name
    const functionName = 'wedding-photo-ec2-launcher';
    
    console.log(`\nSearching for event ID "${eventId}" in logs...`);
    
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
    } else {
      console.log(`No log events found containing event ID "${eventId}"`);
    }
  } catch (error) {
    console.error(`Error searching for event ID "${eventId}" in logs:`, error);
  }
}

// Run the checks
async function runChecks() {
  await checkLambdaLogs();
  
  // If you know the event ID, uncomment and use this
  // const eventId = "your-event-id";
  // await searchForEventInLogs(eventId);
}

runChecks();