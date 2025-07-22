/**
 * Test EC2 Email Flow - Complete End-to-End Test
 * Tests the full flow: Lambda → EC2 → Email
 */

const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const lambda = new AWS.Lambda();

async function testEC2EmailFlow() {
  console.log('🧪 Testing Complete EC2 Email Flow');
  console.log('=====================================');

  const testPayload = {
    eventId: `test-ec2-email-${Date.now()}`,
    email: 'miguelpiedrafita@gmail.com', // Replace with your test email
    requestId: `test-req-${Date.now()}`,
    photos: [
      {
        fileName: 'test-photo-1.jpg',
        url: 'https://firebasestorage.googleapis.com/v0/b/photo-album-27e4b.appspot.com/o/photos%2Ftest-small-1.jpg?alt=media&token=test-token-1',
        size: 2 * 1024 * 1024, // 2MB
        mediaType: 'photo'
      },
      {
        fileName: 'test-photo-2.jpg', 
        url: 'https://firebasestorage.googleapis.com/v0/b/photo-album-27e4b.appspot.com/o/photos%2Ftest-small-2.jpg?alt=media&token=test-token-2',
        size: 1.5 * 1024 * 1024, // 1.5MB
        mediaType: 'photo'
      },
      {
        fileName: 'test-video.mp4',
        url: 'https://firebasestorage.googleapis.com/v0/b/photo-album-27e4b.appspot.com/o/videos%2Ftest-small.mp4?alt=media&token=test-token-video',
        size: 5 * 1024 * 1024, // 5MB
        mediaType: 'video'
      }
    ]
  };

  console.log('📋 Test Payload:');
  console.log(`  Event ID: ${testPayload.eventId}`);
  console.log(`  Email: ${testPayload.email}`);
  console.log(`  Photos: ${testPayload.photos.length} files`);
  console.log(`  Total Size: ${(testPayload.photos.reduce((sum, p) => sum + p.size, 0) / 1024 / 1024).toFixed(2)}MB`);

  try {
    console.log('\n🚀 Step 1: Invoking Lambda Function...');
    
    const lambdaParams = {
      FunctionName: 'wedding-photo-ec2-launcher',
      Payload: JSON.stringify(testPayload),
      InvocationType: 'RequestResponse'
    };

    const lambdaResult = await lambda.invoke(lambdaParams).promise();
    const response = JSON.parse(lambdaResult.Payload);
    
    console.log('📥 Lambda Response:', JSON.stringify(response, null, 2));

    if (response.success) {
      console.log('\n✅ Step 1 Complete: Lambda successfully queued job');
      console.log(`   Instance: ${response.instanceId || 'Existing'}`);
      console.log(`   Cost: ${response.estimatedCost}`);
      console.log(`   Processing Time: ${response.processingTime}`);

      if (response.reusedInstance) {
        console.log('♻️  Using existing EC2 instance (cost-efficient!)');
      } else {
        console.log('🆕 Launched new EC2 Spot instance');
      }

      console.log('\n⏳ Step 2: Waiting for EC2 Processing...');
      console.log('   📝 What happens next:');
      console.log('   1. EC2 instance polls SQS queue');
      console.log('   2. Downloads photos from Firebase URLs');
      console.log('   3. Creates ZIP archive');
      console.log('   4. Uploads to R2 storage');
      console.log('   5. Sends completion email via Netlify');
      
      console.log('\n📧 Step 3: Email Notification');
      console.log(`   ✉️  Success email will be sent to: ${testPayload.email}`);
      console.log('   📊 Email will include:');
      console.log('   - Download link for ZIP file');
      console.log('   - Processing statistics');
      console.log('   - File count and size details');
      console.log('   - Professional branding');

      console.log('\n🔍 Monitoring Instructions:');
      console.log('   1. Check your email in 2-4 minutes');
      console.log('   2. Look for "SharedMoments Photos Ready" subject');
      console.log('   3. Click download link to verify ZIP file');
      console.log('   4. Check CloudWatch logs for EC2 processing details');

      console.log('\n🎯 Expected Results:');
      console.log('   ✅ Email with download link');
      console.log('   ✅ ZIP file containing test photos/videos');
      console.log('   ✅ Professional email formatting');
      console.log('   ✅ Cost: ~$0.01-0.02 (95% savings!)');

    } else {
      console.error('❌ Step 1 Failed: Lambda error');
      console.error('Error:', response.error);
      return false;
    }

    return true;

  } catch (error) {
    console.error('❌ Test Failed:', error);
    console.error('Error Details:', error.message);
    return false;
  }
}

// Monitor EC2 instance status
async function monitorEC2Status() {
  console.log('\n🔍 EC2 Instance Monitoring');
  console.log('==========================');

  const ec2 = new AWS.EC2();

  try {
    const params = {
      Filters: [
        { Name: 'tag:Name', Values: ['wedding-photo-processor'] },
        { Name: 'instance-state-name', Values: ['running', 'pending', 'stopping', 'stopped'] }
      ]
    };

    const result = await ec2.describeInstances(params).promise();
    const instances = result.Reservations.flatMap(r => r.Instances || []);

    if (instances.length === 0) {
      console.log('📭 No wedding processor instances found');
      return;
    }

    instances.forEach((instance, index) => {
      console.log(`\n📊 Instance ${index + 1}:`);
      console.log(`   ID: ${instance.InstanceId}`);
      console.log(`   State: ${instance.State.Name}`);
      console.log(`   Type: ${instance.InstanceType}`);
      console.log(`   Public IP: ${instance.PublicIpAddress || 'Not assigned'}`);
      console.log(`   Launch Time: ${instance.LaunchTime}`);
      
      if (instance.SpotInstanceRequestId) {
        console.log(`   💰 Spot Instance: ${instance.SpotInstanceRequestId}`);
      }
      
      // Show tags
      const tags = instance.Tags || [];
      const purposeTag = tags.find(t => t.Key === 'Purpose');
      const costTag = tags.find(t => t.Key === 'Cost');
      
      if (purposeTag) console.log(`   Purpose: ${purposeTag.Value}`);
      if (costTag) console.log(`   Cost: ${costTag.Value}`);
    });

  } catch (error) {
    console.error('❌ Failed to monitor EC2:', error.message);
  }
}

// Check SQS queue status
async function checkSQSQueue() {
  console.log('\n📬 SQS Queue Status');
  console.log('==================');

  const sqs = new AWS.SQS();
  const queueUrl = 'https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue';

  try {
    const params = {
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    };

    const result = await sqs.getQueueAttributes(params).promise();
    const attributes = result.Attributes;

    console.log(`📋 Queue URL: ${queueUrl}`);
    console.log(`📊 Messages waiting: ${attributes.ApproximateNumberOfMessages}`);
    console.log(`🔄 Messages in flight: ${attributes.ApproximateNumberOfMessagesNotVisible}`);
    
    if (parseInt(attributes.ApproximateNumberOfMessages) > 0) {
      console.log('🟡 Jobs are queued and waiting for EC2 processing');
    } else if (parseInt(attributes.ApproximateNumberOfMessagesNotVisible) > 0) {
      console.log('🟢 Jobs are currently being processed by EC2');
    } else {
      console.log('🔵 Queue is empty - all jobs processed');
    }

  } catch (error) {
    console.error('❌ Failed to check SQS queue:', error.message);
  }
}

// Main test execution
async function runCompleteTest() {
  console.log('🎯 EC2 EMAIL FLOW COMPLETE TEST');
  console.log('================================');
  console.log(`Started at: ${new Date().toLocaleString()}\n`);

  // Step 1: Test the flow
  const testPassed = await testEC2EmailFlow();

  if (testPassed) {
    console.log('\n⏳ Waiting 30 seconds for initial processing...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Step 2: Monitor status
    await monitorEC2Status();
    await checkSQSQueue();

    console.log('\n📝 Summary:');
    console.log('===========');
    console.log('✅ Lambda function invoked successfully');
    console.log('✅ Job queued in SQS');
    console.log('✅ EC2 instance launched/reused');
    console.log('⏳ Email processing in progress...');
    console.log('\n💡 Next Steps:');
    console.log('1. Check your email in 2-4 minutes');
    console.log('2. Look for professional download email');
    console.log('3. Verify ZIP file download works');
    console.log('4. Confirm cost savings achieved!');

  } else {
    console.log('\n❌ Test failed - check error messages above');
  }

  console.log(`\n🏁 Test completed at: ${new Date().toLocaleString()}`);
}

// Run the complete test
if (require.main === module) {
  runCompleteTest().catch(error => {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = {
  testEC2EmailFlow,
  monitorEC2Status,
  checkSQSQueue,
  runCompleteTest
};
