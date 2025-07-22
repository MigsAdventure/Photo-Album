const { EC2Client, GetConsoleOutputCommand } = require('@aws-sdk/client-ec2');

// Initialize EC2 client
const ec2Client = new EC2Client({ region: 'us-east-1' });

async function checkEC2Logs() {
  try {
    // Replace with your EC2 instance ID
    const instanceId = process.env.EC2_INSTANCE_ID;
    
    if (!instanceId) {
      console.error('Error: EC2_INSTANCE_ID environment variable not set');
      console.log('Usage: EC2_INSTANCE_ID=i-xxxxxxxxxx node check-ec2-logs.js');
      process.exit(1);
    }

    console.log(`Fetching logs for EC2 instance: ${instanceId}`);
    
    const command = new GetConsoleOutputCommand({ InstanceId: instanceId });
    const response = await ec2Client.send(command);
    
    if (response.Output) {
      // Console output is base64 encoded
      const decodedOutput = Buffer.from(response.Output, 'base64').toString();
      console.log('EC2 Console Output:');
      console.log(decodedOutput);
    } else {
      console.log('No console output available for the instance');
    }
  } catch (error) {
    console.error('Error fetching EC2 logs:', error);
  }
}

checkEC2Logs();