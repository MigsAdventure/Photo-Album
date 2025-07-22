const { SSMClient, SendCommandCommand } = require('@aws-sdk/client-ssm');

// Initialize SSM client
const ssmClient = new SSMClient({ region: 'us-east-1' });

async function checkEC2LogsWithSSM() {
  try {
    // The EC2 instance ID we found earlier
    const instanceId = 'i-095f3a111b1a6d8cd';
    const eventId = '2025-07-25_23r423_8xron6po';
    
    console.log(`Checking logs on EC2 instance ${instanceId} for event ID ${eventId}...`);
    
    // Command to check application logs
    const command = new SendCommandCommand({
      DocumentName: 'AWS-RunShellScript',
      Parameters: {
        commands: [
          `echo "=== Application Logs for ${eventId} ==="; sudo grep -i "${eventId}" /app/logs/* 2>/dev/null || echo "No application logs found"`,
          `echo "\n=== System Logs for ${eventId} ==="; sudo grep -i "${eventId}" /var/log/messages 2>/dev/null || echo "No system logs found"`,
          `echo "\n=== Node Process Status ==="; ps aux | grep node`,
          `echo "\n=== Recent Application Logs ==="; sudo find /app -name "*.log" -type f -exec ls -la {} \\; 2>/dev/null; sudo find /app -name "*.log" -type f -exec tail -n 20 {} \\; 2>/dev/null || echo "No log files found"`
        ]
      },
      InstanceIds: [instanceId],
      TimeoutSeconds: 30
    });
    
    const response = await ssmClient.send(command);
    
    console.log(`Command ID: ${response.Command.CommandId}`);
    console.log('Command sent successfully. Waiting for results...');
    
    // Wait a moment for the command to execute
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check command status and output
    const { GetCommandInvocationCommand } = require('@aws-sdk/client-ssm');
    const getResultCommand = new GetCommandInvocationCommand({
      CommandId: response.Command.CommandId,
      InstanceId: instanceId
    });
    
    const resultResponse = await ssmClient.send(getResultCommand);
    
    console.log(`Command status: ${resultResponse.Status}`);
    console.log('Command output:');
    console.log(resultResponse.StandardOutputContent);
    
    if (resultResponse.StandardErrorContent) {
      console.log('Error output:');
      console.log(resultResponse.StandardErrorContent);
    }
    
  } catch (error) {
    console.error('Error checking EC2 logs:', error);
  }
}

checkEC2LogsWithSSM();