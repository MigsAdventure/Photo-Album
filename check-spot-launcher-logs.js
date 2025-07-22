const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

// Initialize CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });

async function searchForEventInLogs(eventId) {
  try {
    // Lambda function name - this is the correct function name
    const functionName = 'wedding-photo-spot-launcher';
    
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
    const functionName = 'wedding-photo-spot-launcher';
    console.log(`\nChecking recent invocations of Lambda function: ${functionName}`);
    
    const logGroupName = `/aws/lambda/${functionName}`;
    
    // Get recent logs from the last hour
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - 1);
    
    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime: startTime.getTime(),
      limit: 100
    });
    
    const response = await logsClient.send(command);
    
    if (response.events && response.events.length > 0) {
      console.log(`Found ${response.events.length} recent log events:`);
      
      // Group logs by request ID
      const requestGroups = {};
      
      response.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        
        // Extract request ID if possible
        const requestIdMatch = event.message.match(/RequestId: ([0-9a-f-]+)/);
        if (requestIdMatch && requestIdMatch[1]) {
          const requestId = requestIdMatch[1];
          if (!requestGroups[requestId]) {
            requestGroups[requestId] = [];
          }
          requestGroups[requestId].push({
            timestamp,
            message: event.message
          });
        } else {
          console.log(`[${timestamp}] ${event.message}`);
        }
      });
      
      // Print grouped logs
      console.log(`\nFound ${Object.keys(requestGroups).length} request groups:`);
      
      for (const [requestId, events] of Object.entries(requestGroups)) {
        console.log(`\n--- Request ID: ${requestId} ---`);
        events.forEach(event => {
          console.log(`[${event.timestamp}] ${event.message}`);
        });
      }
    } else {
      console.log('No recent log events found');
    }
  } catch (error) {
    console.error('Error checking recent Lambda invocations:', error);
  }
}

// Check for any mentions of email in the logs
async function searchForEmail(email) {
  try {
    const functionName = 'wedding-photo-spot-launcher';
    console.log(`\nSearching for email "${email}" in Lambda logs...`);
    
    const logGroupName = `/aws/lambda/${functionName}`;
    
    // Get logs from the last day
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - 24);
    
    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime: startTime.getTime(),
      filterPattern: email,
      limit: 100
    });
    
    const response = await logsClient.send(command);
    
    if (response.events && response.events.length > 0) {
      console.log(`Found ${response.events.length} log events containing email "${email}":`);
      response.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        console.log(`[${timestamp}] ${event.message}`);
      });
      return true;
    } else {
      console.log(`No log events found containing email "${email}"`);
      return false;
    }
  } catch (error) {
    console.error(`Error searching for email "${email}" in logs:`, error);
    return false;
  }
}

async function runChecks() {
  const eventId = "2025-07-25_23r423_8xron6po";
  const email = "migsub77@gmail.com";
  
  let found = await searchForEventInLogs(eventId);
  
  if (!found) {
    console.log("\nEvent ID not found. Searching for email...");
    found = await searchForEmail(email);
  }
  
  if (!found) {
    console.log("\nNeither event ID nor email found. Checking recent Lambda invocations...");
    await checkRecentInvocations();
  }
}

runChecks();