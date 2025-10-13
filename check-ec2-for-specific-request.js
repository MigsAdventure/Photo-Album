// Check AWS EC2 and SQS for the specific request ID: 53gvnj7pc
const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const { SQSClient, GetQueueAttributesCommand, ReceiveMessageCommand } = require('@aws-sdk/client-sqs');
const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

const REQUEST_ID = '53gvnj7pc';
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';

async function checkAWSPipeline() {
  console.log(`🔍 Investigating request: ${REQUEST_ID}`);
  console.log(`📧 Email: migsub77@gmail.com`);
  console.log(`⏰ Timestamp: 2025-10-13 00:05:23 UTC\n`);
  
  // Step 1: Check if EC2 instance was launched
  console.log('=' .repeat(80));
  console.log('STEP 1: Checking EC2 Instances');
  console.log('=' .repeat(80));
  
  try {
    const ec2 = new EC2Client({ region: 'us-east-1' });
    
    // Check for instances launched around that time
    const describeCommand = new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:Name', Values: ['wedding-photo-processor'] }
      ]
    });
    
    const ec2Response = await ec2.send(describeCommand);
    
    if (!ec2Response.Reservations || ec2Response.Reservations.length === 0) {
      console.log('❌ NO EC2 instances found with tag "wedding-photo-processor"');
      console.log('This means:');
      console.log('  - Lambda might have failed to launch EC2');
      console.log('  - OR EC2 already terminated');
      console.log('  - OR EC2 has a different tag name');
    } else {
      console.log(`✅ Found ${ec2Response.Reservations.length} EC2 reservation(s):\n`);
      
      ec2Response.Reservations.forEach((reservation, idx) => {
        reservation.Instances.forEach((instance, iIdx) => {
          const launchTime = instance.LaunchTime ? new Date(instance.LaunchTime).toISOString() : 'Unknown';
          const state = instance.State?.Name || 'Unknown';
          const instanceId = instance.InstanceId;
          const publicIp = instance.PublicIpAddress || 'N/A';
          
          console.log(`Instance ${idx + 1}.${iIdx + 1}:`);
          console.log(`  ID: ${instanceId}`);
          console.log(`  State: ${state}`);
          console.log(`  Launch Time: ${launchTime}`);
          console.log(`  Public IP: ${publicIp}`);
          
          // Check tags
          if (instance.Tags) {
            console.log('  Tags:');
            instance.Tags.forEach(tag => {
              console.log(`    ${tag.Key}: ${tag.Value}`);
            });
          }
          console.log('');
        });
      });
    }
  } catch (error) {
    console.log('❌ Error checking EC2:', error.message);
  }
  
  // Step 2: Check SQS Queue
  console.log('\n' + '=' .repeat(80));
  console.log('STEP 2: Checking SQS Queue');
  console.log('=' .repeat(80));
  
  try {
    const sqs = new SQSClient({ region: 'us-east-1' });
    
    // Get queue attributes
    const attrCommand = new GetQueueAttributesCommand({
      QueueUrl: QUEUE_URL,
      AttributeNames: ['All']
    });
    
    const queueResponse = await sqs.send(attrCommand);
    const attrs = queueResponse.Attributes || {};
    
    console.log('\nQueue Status:');
    console.log(`  Messages Available: ${attrs.ApproximateNumberOfMessages || 0}`);
    console.log(`  Messages In Flight: ${attrs.ApproximateNumberOfMessagesNotVisible || 0}`);
    console.log(`  Messages Delayed: ${attrs.ApproximateNumberOfMessagesDelayed || 0}`);
    
    if (parseInt(attrs.ApproximateNumberOfMessages || '0') > 0) {
      console.log('\n⚠️ Messages stuck in queue! Trying to peek at them...\n');
      
      // Try to receive messages without deleting them
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 10,
        WaitTimeSeconds: 2
      });
      
      const messages = await sqs.send(receiveCommand);
      
      if (messages.Messages && messages.Messages.length > 0) {
        console.log(`Found ${messages.Messages.length} message(s) in queue:\n`);
        
        messages.Messages.forEach((msg, idx) => {
          console.log(`Message ${idx + 1}:`);
          try {
            const body = JSON.parse(msg.Body || '{}');
            console.log(`  Request ID: ${body.requestId || 'N/A'}`);
            console.log(`  Event ID: ${body.eventId || 'N/A'}`);
            console.log(`  Email: ${body.email || 'N/A'}`);
            console.log(`  Photos: ${body.photos?.length || 0}`);
            console.log(`  Timestamp: ${body.timestamp || 'N/A'}`);
            
            if (body.requestId === REQUEST_ID) {
              console.log('  🎯 THIS IS OUR REQUEST!');
            }
          } catch (e) {
            console.log(`  Body: ${msg.Body}`);
          }
          console.log('');
        });
      } else {
        console.log('No messages retrieved (they might be in flight or delayed)');
      }
    } else {
      console.log('\n✅ Queue is empty - messages were processed or never arrived');
    }
    
  } catch (error) {
    console.log('❌ Error checking SQS:', error.message);
  }
  
  // Step 3: Check Lambda Logs
  console.log('\n' + '=' .repeat(80));
  console.log('STEP 3: Checking Lambda Logs (around 00:05:23 UTC)');
  console.log('=' .repeat(80));
  
  try {
    const logs = new CloudWatchLogsClient({ region: 'us-east-1' });
    
    // Check logs from 5 minutes before to 5 minutes after
    const targetTime = new Date('2025-10-13T00:05:23Z').getTime();
    const startTime = targetTime - (5 * 60 * 1000);
    const endTime = targetTime + (5 * 60 * 1000);
    
    const filterCommand = new FilterLogEventsCommand({
      logGroupName: '/aws/lambda/wedding-photo-spot-launcher',
      startTime,
      endTime,
      limit: 100
    });
    
    const logResponse = await logs.send(filterCommand);
    
    if (!logResponse.events || logResponse.events.length === 0) {
      console.log('❌ No Lambda logs found in this time window');
      console.log('This means Lambda was NOT invoked around this time');
    } else {
      console.log(`\n✅ Found ${logResponse.events.length} log events:\n`);
      
      logResponse.events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        console.log(`[${timestamp}] ${event.message}`);
      });
    }
    
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      console.log('❌ Lambda log group not found - Lambda might not exist or never ran');
    } else {
      console.log('❌ Error checking Lambda logs:', error.message);
    }
  }
  
  console.log('\n' + '=' .repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('=' .repeat(80));
}

checkAWSPipeline().catch(console.error);
