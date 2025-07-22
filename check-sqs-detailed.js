const { SQSClient, GetQueueAttributesCommand, ListQueuesCommand, ReceiveMessageCommand } = require('@aws-sdk/client-sqs');

// Initialize SQS client
const sqsClient = new SQSClient({ region: 'us-east-1' });

async function listAllQueues() {
  try {
    console.log('Listing all SQS queues...');
    
    const command = new ListQueuesCommand({});
    const response = await sqsClient.send(command);
    
    if (response.QueueUrls && response.QueueUrls.length > 0) {
      console.log(`Found ${response.QueueUrls.length} queues:`);
      response.QueueUrls.forEach(queueUrl => {
        console.log(`- ${queueUrl}`);
      });
      return response.QueueUrls;
    } else {
      console.log('No queues found');
      return [];
    }
  } catch (error) {
    console.error('Error listing queues:', error);
    return [];
  }
}

async function checkQueueDetails(queueUrl) {
  try {
    console.log(`\nChecking details for queue: ${queueUrl}`);
    
    // Get queue attributes
    const attributesCommand = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages', 
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed',
        'CreatedTimestamp',
        'LastModifiedTimestamp',
        'QueueArn',
        'VisibilityTimeout',
        'MaximumMessageSize',
        'MessageRetentionPeriod'
      ]
    });
    
    const attributesResponse = await sqsClient.send(attributesCommand);
    
    console.log('Queue attributes:');
    console.log(`- Messages available: ${attributesResponse.Attributes.ApproximateNumberOfMessages}`);
    console.log(`- Messages in flight: ${attributesResponse.Attributes.ApproximateNumberOfMessagesNotVisible}`);
    console.log(`- Messages delayed: ${attributesResponse.Attributes.ApproximateNumberOfMessagesDelayed}`);
    console.log(`- Created: ${new Date(parseInt(attributesResponse.Attributes.CreatedTimestamp) * 1000).toISOString()}`);
    console.log(`- Last modified: ${new Date(parseInt(attributesResponse.Attributes.LastModifiedTimestamp) * 1000).toISOString()}`);
    console.log(`- ARN: ${attributesResponse.Attributes.QueueArn}`);
    console.log(`- Visibility timeout: ${attributesResponse.Attributes.VisibilityTimeout} seconds`);
    console.log(`- Maximum message size: ${attributesResponse.Attributes.MaximumMessageSize} bytes`);
    console.log(`- Message retention period: ${attributesResponse.Attributes.MessageRetentionPeriod} seconds`);
    
    // Try to peek at messages
    if (attributesResponse.Attributes.ApproximateNumberOfMessages > 0) {
      await peekMessages(queueUrl);
    }
  } catch (error) {
    console.error(`Error checking queue details for ${queueUrl}:`, error);
  }
}

async function peekMessages(queueUrl) {
  try {
    console.log(`\nPeeking at messages in queue: ${queueUrl}`);
    
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 0,  // Don't hide the message
      WaitTimeSeconds: 0,    // Don't wait for new messages
      AttributeNames: ['All'],
      MessageAttributeNames: ['All']
    });
    
    const receiveResponse = await sqsClient.send(receiveCommand);
    
    if (receiveResponse.Messages && receiveResponse.Messages.length > 0) {
      console.log(`Found ${receiveResponse.Messages.length} messages:`);
      
      receiveResponse.Messages.forEach((message, index) => {
        console.log(`\nMessage ${index + 1}:`);
        console.log(`- Message ID: ${message.MessageId}`);
        console.log(`- Receipt Handle: ${message.ReceiptHandle.substring(0, 20)}...`);
        
        if (message.Attributes) {
          console.log('- Attributes:');
          Object.entries(message.Attributes).forEach(([key, value]) => {
            console.log(`  - ${key}: ${value}`);
          });
        }
        
        if (message.MessageAttributes) {
          console.log('- Message Attributes:');
          Object.entries(message.MessageAttributes).forEach(([key, value]) => {
            console.log(`  - ${key}: ${value.StringValue || value.BinaryValue || value.DataType}`);
          });
        }
        
        try {
          const body = JSON.parse(message.Body);
          console.log('- Body (parsed):');
          console.log(JSON.stringify(body, null, 2));
        } catch (e) {
          console.log('- Body (raw):');
          console.log(message.Body);
        }
      });
    } else {
      console.log('No messages found in queue');
    }
  } catch (error) {
    console.error(`Error peeking at messages in ${queueUrl}:`, error);
  }
}

async function checkWeddingPhotoQueue() {
  try {
    // Check the specific wedding photo queue
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';
    console.log(`Checking wedding photo processing queue: ${queueUrl}`);
    
    await checkQueueDetails(queueUrl);
  } catch (error) {
    console.error('Error checking wedding photo queue:', error);
  }
}

async function runChecks() {
  // First check the specific wedding photo queue
  await checkWeddingPhotoQueue();
  
  // Then list and check all queues
  const queues = await listAllQueues();
  
  // Check each queue except the wedding photo queue which we already checked
  const weddingQueueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';
  for (const queueUrl of queues) {
    if (queueUrl !== weddingQueueUrl) {
      await checkQueueDetails(queueUrl);
    }
  }
}

runChecks();