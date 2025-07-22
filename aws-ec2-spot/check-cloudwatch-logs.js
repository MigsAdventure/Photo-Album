const { CloudWatchLogsClient, DescribeLogGroupsCommand, GetLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

// Initialize CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });

async function checkCloudWatchLogs() {
  try {
    console.log('Checking CloudWatch Logs for wedding-photo-processor...');
    
    // List log groups
    const logGroupsCommand = new DescribeLogGroupsCommand({
      logGroupNamePrefix: '/wedding-photo-processor'
    });
    
    const logGroupsResponse = await logsClient.send(logGroupsCommand);
    
    if (!logGroupsResponse.logGroups || logGroupsResponse.logGroups.length === 0) {
      console.log('No log groups found with prefix /wedding-photo-processor');
      return;
    }
    
    console.log(`Found ${logGroupsResponse.logGroups.length} log groups:`);
    
    for (const logGroup of logGroupsResponse.logGroups) {
      console.log(`\nLog Group: ${logGroup.logGroupName}`);
      
      // Get log streams for this group
      const { DescribeLogStreamsCommand } = require('@aws-sdk/client-cloudwatch-logs');
      const logStreamsCommand = new DescribeLogStreamsCommand({
        logGroupName: logGroup.logGroupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 5
      });
      
      const logStreamsResponse = await logsClient.send(logStreamsCommand);
      
      if (!logStreamsResponse.logStreams || logStreamsResponse.logStreams.length === 0) {
        console.log('  No log streams found');
        continue;
      }
      
      console.log(`  Found ${logStreamsResponse.logStreams.length} log streams:`);
      
      // Get events from the most recent log stream
      const mostRecentStream = logStreamsResponse.logStreams[0];
      console.log(`  Most recent stream: ${mostRecentStream.logStreamName}`);
      
      const logEventsCommand = new GetLogEventsCommand({
        logGroupName: logGroup.logGroupName,
        logStreamName: mostRecentStream.logStreamName,
        limit: 20,
        startFromHead: false
      });
      
      const logEventsResponse = await logsClient.send(logEventsCommand);
      
      if (!logEventsResponse.events || logEventsResponse.events.length === 0) {
        console.log('  No log events found');
        continue;
      }
      
      console.log(`  Recent log events:`);
      logEventsResponse.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        console.log(`  [${timestamp}] ${event.message}`);
      });
    }
    
  } catch (error) {
    console.error('Error checking CloudWatch Logs:', error);
  }
}

// Check for a specific event ID
async function searchEventInLogs(eventId) {
  try {
    console.log(`\nSearching for event ID "${eventId}" in CloudWatch Logs...`);
    
    const logGroupNames = [
      '/wedding-photo-processor/application',
      '/wedding-photo-processor/system',
      '/wedding-photo-processor/bootstrap'
    ];
    
    for (const logGroupName of logGroupNames) {
      console.log(`\nSearching in log group: ${logGroupName}`);
      
      try {
        // Use FilterLogEvents to search across all streams
        const { FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
        const filterCommand = new FilterLogEventsCommand({
          logGroupName,
          filterPattern: eventId,
          limit: 100
        });
        
        const filterResponse = await logsClient.send(filterCommand);
        
        if (!filterResponse.events || filterResponse.events.length === 0) {
          console.log(`  No events found containing "${eventId}"`);
          continue;
        }
        
        console.log(`  Found ${filterResponse.events.length} events containing "${eventId}":`);
        filterResponse.events.forEach(event => {
          const timestamp = new Date(event.timestamp).toISOString();
          console.log(`  [${timestamp}] ${event.message}`);
        });
      } catch (error) {
        console.log(`  Error searching log group ${logGroupName}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(`Error searching for event ID "${eventId}":`, error);
  }
}

async function run() {
  await checkCloudWatchLogs();
  
  // If you want to search for a specific event ID, uncomment and modify this line
  // await searchEventInLogs('your-event-id');
}

run();
