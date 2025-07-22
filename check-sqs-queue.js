const { SQSClient, GetQueueAttributesCommand, ReceiveMessageCommand } = require('@aws-sdk/client-sqs');

// Initialize SQS client
const sqsClient = new SQSClient({ region: 'us-east-1' });

async function checkSQSQueue() {
  try {
    // Replace with your SQS queue URL
    const queueUrl = process.env.SQS_QUEUE_URL;
    
    if (!queueUrl) {
      console.error('Error: SQS_QUEUE_URL environment variable not set');
      console.log('Usage: SQS_QUEUE_URL=https://sqs.region.amazonaws.com/account/queue node check-sqs-queue.js');
      process.exit(1);
    }

    console.log(`Checking SQS queue: ${queueUrl}`);
    
    // Get queue attributes
    const attributesCommand = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    });
    
    const attributesResponse = await sqsClient.send(attributesCommand);
    
    console.log('Queue attributes:');
    console.log(`- Messages available: ${attributesResponse.Attributes.ApproximateNumberOfMessages}`);
    console.log(`- Messages in flight: ${attributesResponse.Attributes.ApproximateNumberOfMessagesNotVisible}`);
    
    // Try to receive messages (peek)
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 0,  // Don't hide the message
      WaitTimeSeconds: 0     // Don't wait for new messages
    });
    
    const receiveResponse = await sqsClient.send(receiveCommand);
    
    if (receiveResponse.Messages && receiveResponse.Messages.length > 0) {
      console.log(`\nFound ${receiveResponse.Messages.length} messages in queue:`);
      receiveResponse.Messages.forEach((message, index) => {
        console.log(`\nMessage ${index + 1}:`);
        try {
          const body = JSON.parse(message.Body);
          console.log(JSON.stringify(body, null, 2));
        } catch (e) {
          console.log(message.Body);
        }
      });
    } else {
      console.log('\nNo messages currently in queue');
    }
  } catch (error) {
    console.error('Error checking SQS queue:', error);
  }
}

checkSQSQueue();