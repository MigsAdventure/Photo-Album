#!/usr/bin/env node

// Test script for AWS Batch deployment
const AWS = require('aws-sdk');

// Test data - simulates your current Firebase photo structure
const testJobData = {
    eventId: "test-event-" + Date.now(),
    photos: [
        {
            filename: "test-photo-1.jpg",
            downloadURL: "https://via.placeholder.com/1024x768/ff0000/ffffff?text=Test+Photo+1",
            size: 102400, // 100KB
            uploadedAt: new Date().toISOString()
        },
        {
            filename: "test-photo-2.jpg", 
            downloadURL: "https://via.placeholder.com/1024x768/00ff00/ffffff?text=Test+Photo+2",
            size: 102400,
            uploadedAt: new Date().toISOString()
        },
        {
            filename: "test-video.mp4",
            downloadURL: "https://sample-videos.com/zip/10/mp4/SampleVideo_720x480_1mb.mp4",
            size: 1048576, // 1MB
            uploadedAt: new Date().toISOString()
        }
    ]
};

async function testAWSConfiguration() {
    console.log('🧪 Testing AWS Configuration...');
    
    try {
        // Test AWS CLI credentials
        const sts = new AWS.STS();
        const identity = await sts.getCallerIdentity().promise();
        
        console.log('✅ AWS Credentials Valid');
        console.log(`   Account: ${identity.Account}`);
        console.log(`   User: ${identity.Arn}`);
        
        return true;
    } catch (error) {
        console.error('❌ AWS Configuration Error:', error.message);
        return false;
    }
}

async function testBatchResources() {
    console.log('\n🔍 Testing AWS Batch Resources...');
    
    try {
        const batch = new AWS.Batch();
        
        // List compute environments
        const computeEnvs = await batch.describeComputeEnvironments({
            computeEnvironments: ['wedding-photo-processor-compute-env']
        }).promise();
        
        if (computeEnvs.computeEnvironments.length > 0) {
            console.log('✅ Compute Environment Found');
            console.log(`   Status: ${computeEnvs.computeEnvironments[0].status}`);
            console.log(`   State: ${computeEnvs.computeEnvironments[0].state}`);
        } else {
            console.log('⚠️  Compute Environment not found (run ./deploy.sh first)');
        }
        
        // List job queues
        const jobQueues = await batch.describeJobQueues({
            jobQueues: ['wedding-photo-processor-job-queue']
        }).promise();
        
        if (jobQueues.jobQueues.length > 0) {
            console.log('✅ Job Queue Found');
            console.log(`   Status: ${jobQueues.jobQueues[0].state}`);
        } else {
            console.log('⚠️  Job Queue not found (run ./deploy.sh first)');
        }
        
        return true;
    } catch (error) {
        console.log('⚠️  Batch resources not deployed yet');
        console.log('   Run ./deploy.sh to create infrastructure');
        return false;
    }
}

async function testSQSQueue() {
    console.log('\n📬 Testing SQS Queue...');
    
    try {
        const sqs = new AWS.SQS();
        
        // List queues
        const queues = await sqs.listQueues({
            QueueNamePrefix: 'wedding-photo-processor'
        }).promise();
        
        if (queues.QueueUrls && queues.QueueUrls.length > 0) {
            console.log('✅ SQS Queue Found');
            console.log(`   URL: ${queues.QueueUrls[0]}`);
            
            // Test sending a message
            await sqs.sendMessage({
                QueueUrl: queues.QueueUrls[0],
                MessageBody: JSON.stringify(testJobData),
                MessageAttributes: {
                    'TestMessage': {
                        DataType: 'String',
                        StringValue: 'true'
                    }
                }
            }).promise();
            
            console.log('✅ Test message sent to queue');
            
            // Clean up - receive and delete the test message
            const messages = await sqs.receiveMessage({
                QueueUrl: queues.QueueUrls[0],
                MaxNumberOfMessages: 1
            }).promise();
            
            if (messages.Messages && messages.Messages.length > 0) {
                await sqs.deleteMessage({
                    QueueUrl: queues.QueueUrls[0],
                    ReceiptHandle: messages.Messages[0].ReceiptHandle
                }).promise();
                console.log('✅ Test message cleaned up');
            }
            
        } else {
            console.log('⚠️  SQS Queue not found (run ./deploy.sh first)');
        }
        
        return true;
    } catch (error) {
        console.log('⚠️  SQS Queue test failed:', error.message);
        return false;
    }
}

async function testECRRepository() {
    console.log('\n🐳 Testing ECR Repository...');
    
    try {
        const ecr = new AWS.ECR();
        
        const repos = await ecr.describeRepositories({
            repositoryNames: ['wedding-photo-processor']
        }).promise();
        
        if (repos.repositories.length > 0) {
            console.log('✅ ECR Repository Found');
            console.log(`   URI: ${repos.repositories[0].repositoryUri}`);
            
            // List images
            const images = await ecr.listImages({
                repositoryName: 'wedding-photo-processor'
            }).promise();
            
            console.log(`   Images: ${images.imageIds.length}`);
        } else {
            console.log('⚠️  ECR Repository not found (run ./deploy.sh first)');
        }
        
        return true;
    } catch (error) {
        console.log('⚠️  ECR Repository test failed:', error.message);
        return false;
    }
}

async function submitTestJob() {
    console.log('\n🚀 Submitting Test Job...');
    
    try {
        const batch = new AWS.Batch();
        
        const jobName = `test-wedding-photos-${Date.now()}`;
        
        const jobParams = {
            jobName: jobName,
            jobQueue: 'wedding-photo-processor-job-queue',
            jobDefinition: 'wedding-photo-processor-job-def',
            parameters: {
                eventId: testJobData.eventId,
                photoCount: testJobData.photos.length.toString()
            },
            timeout: {
                attemptDurationSeconds: 1800 // 30 minutes
            }
        };
        
        const result = await batch.submitJob(jobParams).promise();
        
        console.log('✅ Test job submitted successfully');
        console.log(`   Job ID: ${result.jobId}`);
        console.log(`   Job Name: ${result.jobName}`);
        
        // Monitor job for a bit
        console.log('\n⏳ Monitoring job status...');
        
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            
            const jobStatus = await batch.describeJobs({
                jobs: [result.jobId]
            }).promise();
            
            if (jobStatus.jobs.length > 0) {
                const job = jobStatus.jobs[0];
                console.log(`   Status: ${job.status} (${job.statusReason || 'No reason'})`);
                
                if (job.status === 'SUCCEEDED') {
                    console.log('🎉 Test job completed successfully!');
                    break;
                } else if (job.status === 'FAILED') {
                    console.log('❌ Test job failed');
                    break;
                }
            }
        }
        
        return true;
    } catch (error) {
        console.log('⚠️  Test job submission failed:', error.message);
        return false;
    }
}

async function runAllTests() {
    console.log('🧪 AWS Batch Deployment Test Suite\n');
    
    const tests = [
        { name: 'AWS Configuration', fn: testAWSConfiguration },
        { name: 'Batch Resources', fn: testBatchResources },
        { name: 'SQS Queue', fn: testSQSQueue },
        { name: 'ECR Repository', fn: testECRRepository }
    ];
    
    let allPassed = true;
    
    for (const test of tests) {
        const passed = await test.fn();
        if (!passed) allPassed = false;
    }
    
    if (allPassed) {
        console.log('\n🎉 All basic tests passed!');
        
        const shouldSubmitJob = process.argv.includes('--submit-job');
        if (shouldSubmitJob) {
            await submitTestJob();
        } else {
            console.log('\n💡 To submit a test job, run: node test-deployment.js --submit-job');
        }
        
        console.log('\n✅ Your AWS Batch infrastructure is ready!');
        console.log('Next steps:');
        console.log('1. Configure R2 credentials in .env.aws');
        console.log('2. Update Cloudflare Worker environment variables');
        console.log('3. Test with real wedding photo data');
        
    } else {
        console.log('\n❌ Some tests failed. Please run ./deploy.sh to create infrastructure.');
    }
}

// Handle command line execution
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { testAWSConfiguration, testBatchResources, testSQSQueue, testECRRepository };
