const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function checkEC2Status() {
  try {
    console.log('Checking EC2 instance status...');
    
    // Get the instance ID
    const instanceIdResult = await execPromise('aws ec2 describe-instances --filters "Name=tag:Name,Values=wedding-photo-processor" --query "Reservations[0].Instances[0].InstanceId" --output text');
    const instanceId = instanceIdResult.stdout.trim();
    
    if (!instanceId || instanceId === 'None') {
      console.log('❌ No EC2 instance found with the tag "wedding-photo-processor"');
      return;
    }
    
    console.log(`✅ Found EC2 instance: ${instanceId}`);
    
    // Get the instance status
    const statusResult = await execPromise(`aws ec2 describe-instances --instance-ids ${instanceId} --query "Reservations[0].Instances[0].State.Name" --output text`);
    const status = statusResult.stdout.trim();
    
    console.log(`✅ Instance status: ${status}`);
    
    if (status !== 'running') {
      console.log('❌ Instance is not running. Cannot check logs.');
      return;
    }
    
    // Get the instance public IP
    const ipResult = await execPromise(`aws ec2 describe-instances --instance-ids ${instanceId} --query "Reservations[0].Instances[0].PublicIpAddress" --output text`);
    const publicIp = ipResult.stdout.trim();
    
    console.log(`✅ Instance public IP: ${publicIp}`);
    
    // Send SSH key to the instance
    console.log('Sending SSH key to the instance...');
    await execPromise(`aws ec2-instance-connect send-ssh-public-key --instance-id ${instanceId} --availability-zone us-east-1c --instance-os-user ec2-user --ssh-public-key file:///tmp/ec2-key.pub`);
    
    // Check if the process is running
    console.log('Checking if the process is running...');
    try {
      const processResult = await execPromise(`ssh -i /tmp/ec2-key -o StrictHostKeyChecking=no ec2-user@${publicIp} "sudo ps aux | grep node"`);
      console.log('Process status:');
      console.log(processResult.stdout);
    } catch (error) {
      console.log('❌ Failed to check process status:', error.message);
    }
    
    // Check the log file
    console.log('Checking the log file...');
    try {
      const logResult = await execPromise(`ssh -i /tmp/ec2-key -o StrictHostKeyChecking=no ec2-user@${publicIp} "sudo find /app -name '*.log' | xargs sudo tail -n 50"`);
      console.log('Log file content:');
      console.log(logResult.stdout);
    } catch (error) {
      console.log('❌ Failed to check log file:', error.message);
    }
    
    // Check if there are any errors in the log file
    console.log('Checking for errors in the log file...');
    try {
      const errorResult = await execPromise(`ssh -i /tmp/ec2-key -o StrictHostKeyChecking=no ec2-user@${publicIp} "sudo find /app -name '*.log' | xargs sudo grep -i error"`);
      console.log('Errors found:');
      console.log(errorResult.stdout);
    } catch (error) {
      if (error.stderr.includes('No such file or directory')) {
        console.log('✅ No log files found');
      } else if (error.stderr.includes('grep: No match')) {
        console.log('✅ No errors found in log files');
      } else {
        console.log('❌ Failed to check for errors:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking EC2 status:', error);
  }
}

checkEC2Status().catch(console.error);