const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

// Initialize CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });

async function searchEventInLogs(eventId) {
  try {
    console.log(`Searching for event ID "${eventId}" in CloudWatch Logs...`);
    
    // First, check if the log groups exist
    const logGroupsCommand = new DescribeLogGroupsCommand({
      logGroupNamePrefix: '/wedding-photo-processor'
    });
    
    const logGroupsResponse = await logsClient.send(logGroupsCommand);
    
    if (!logGroupsResponse.logGroups || logGroupsResponse.logGroups.length === 0) {
      console.log('No log groups found with prefix /wedding-photo-processor');
      console.log('The CloudWatch Logs agent might still be initializing on the EC2 instance.');
      console.log('Please wait a few minutes and try again.');
      return;
    }
    
    console.log(`Found ${logGroupsResponse.logGroups.length} log groups:`);
    logGroupsResponse.logGroups.forEach(group => {
      console.log(`- ${group.logGroupName}`);
    });
    
    // Search for the event ID in each log group
    for (const logGroup of logGroupsResponse.logGroups) {
      console.log(`\nSearching in log group: ${logGroup.logGroupName}`);
      
      try {
        const filterCommand = new FilterLogEventsCommand({
          logGroupName: logGroup.logGroupName,
          filterPattern: eventId,
          limit: 100
        });
        
        const filterResponse = await logsClient.send(filterCommand);
        
        if (!filterResponse.events || filterResponse.events.length === 0) {
          console.log(`No events found containing "${eventId}" in this log group`);
          continue;
        }
        
        console.log(`Found ${filterResponse.events.length} events containing "${eventId}":`);
        filterResponse.events.forEach(event => {
          const timestamp = new Date(event.timestamp).toISOString();
          console.log(`[${timestamp}] ${event.message}`);
        });
      } catch (error) {
        console.log(`Error searching log group ${logGroup.logGroupName}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`Error searching for event ID:`, error);
  }
}

async function run() {
  const eventId = process.argv[2] || '2025-07-25_23r423_8xron6po';
  await searchEventInLogs(eventId);
}

run();