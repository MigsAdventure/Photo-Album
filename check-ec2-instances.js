const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');

// Initialize EC2 client
const ec2Client = new EC2Client({ region: 'us-east-1' });

async function checkEC2Instances() {
  try {
    // Filter for wedding photo processor instances
    const params = {
      Filters: [
        { Name: 'tag:Name', Values: ['wedding-photo-processor'] }
      ]
    };
    
    console.log('Checking for wedding photo processor EC2 instances...');
    
    const command = new DescribeInstancesCommand(params);
    const response = await ec2Client.send(command);
    
    if (response.Reservations && response.Reservations.length > 0) {
      console.log(`Found ${response.Reservations.length} reservation(s)`);
      
      let instances = [];
      response.Reservations.forEach(reservation => {
        if (reservation.Instances && reservation.Instances.length > 0) {
          instances = instances.concat(reservation.Instances);
        }
      });
      
      if (instances.length > 0) {
        console.log(`Found ${instances.length} instance(s):`);
        instances.forEach(instance => {
          console.log(`\nInstance ID: ${instance.InstanceId}`);
          console.log(`State: ${instance.State.Name}`);
          console.log(`Instance Type: ${instance.InstanceType}`);
          console.log(`Public IP: ${instance.PublicIpAddress || 'N/A'}`);
          console.log(`Launch Time: ${instance.LaunchTime}`);
          
          if (instance.Tags && instance.Tags.length > 0) {
            console.log('Tags:');
            instance.Tags.forEach(tag => {
              console.log(`  - ${tag.Key}: ${tag.Value}`);
            });
          }
        });
      } else {
        console.log('No instances found');
      }
    } else {
      console.log('No instances found');
    }
  } catch (error) {
    console.error('Error checking EC2 instances:', error);
  }
}

checkEC2Instances();