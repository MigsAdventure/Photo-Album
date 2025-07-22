const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

// Initialize CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });

async function checkLambdaLogs() {
  try {
    // Replace with your Lambda function name
    const functionName = process.env.LAMBDA_FUNCTION_NAME;
    
    if (!functionName) {
      console.error('Error: LAMBDA_FUNCTION_NAME environment variable not set');
      console.log('Usage: LAMBDA_FUNCTION_NAME=your-function-name node check-lambda-logs.js');
      process.exit(1);
    }

    const logGroupName = `/aws/lambda/${functionName}`;
    console.log(`Fetching logs from ${logGroupName}`);
    
    // Get logs from the last 30 minutes
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - 30);
    
    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime: startTime.getTime(),
      limit: 100
    });
    
    const response = await logsClient.send(command);
    
    if (response.events && response.events.length > 0) {
      console.log('Recent Lambda logs:');
      response.events.forEach(event => {
        console.log(`[${new Date(event.timestamp).toISOString()}] ${event.message}`);
      });
    } else {
      console.log('No recent logs found for the Lambda function');
    }
  } catch (error) {
    console.error('Error fetching Lambda logs:', error);
  }
}

checkLambdaLogs();