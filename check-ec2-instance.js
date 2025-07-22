const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');

// Initialize EC2 client
const ec2Client = new EC2Client({ region: 'us-east-1' });

async function checkEC2Instance() {
  try {
    const instanceId = 'i-095f3a111b1a6d8cd';
    
    console.log(`Checking EC2 instance: ${instanceId}`);
    
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    });
    
    const response = await ec2Client.send(command);
    
    if (response.Reservations && response.Reservations.length > 0 && 
        response.Reservations[0].Instances && response.Reservations[0].Instances.length > 0) {
      
      const instance = response.Reservations[0].Instances[0];
      
      console.log('Instance details:');
      console.log(`- Instance ID: ${instance.InstanceId}`);
      console.log(`- State: ${instance.State.Name}`);
      console.log(`- Public IP: ${instance.PublicIpAddress || 'N/A'}`);
      console.log(`- Launch time: ${instance.LaunchTime}`);
      
      // Check if the instance is running
      if (instance.State.Name === 'running') {
        console.log('✅ Instance is running');
        
        // Check if the instance has a public IP
        if (instance.PublicIpAddress) {
          console.log(`✅ Instance has public IP: ${instance.PublicIpAddress}`);
        } else {
          console.log('❌ Instance does not have a public IP');
        }
      } else {
        console.log(`❌ Instance is not running (state: ${instance.State.Name})`);
      }
      
    } else {
      console.log(`❌ Instance ${instanceId} not found`);
    }
  } catch (error) {
    console.error('Error checking EC2 instance:', error);
  }
}

checkEC2Instance();