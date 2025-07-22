const AWS = require('aws-sdk');
const archiver = require('archiver');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const { promisify } = require('util');

// AWS Configuration
AWS.config.update({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
});

const s3 = new AWS.S3();
const sqs = new AWS.SQS();

// Performance Configuration
const DOWNLOAD_CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MAX_CONCURRENT_DOWNLOADS = 5;
const UPLOAD_PART_SIZE = 5 * 1024 * 1024; // 5MB for multipart uploads

// Cloudflare R2 Configuration (S3-compatible)
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'wedding-photos';

// Email Configuration
const EMAIL_WEBHOOK_URL = process.env.EMAIL_WEBHOOK_URL;

// Initialize R2 client
const r2Client = new AWS.S3({
    endpoint: R2_ENDPOINT,
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
    s3ForcePathStyle: true,
    signatureVersion: 'v4'
});

class HighPerformanceProcessor {
    constructor() {
        this.processId = uuidv4();
        this.startTime = Date.now();
        this.stats = {
            filesProcessed: 0,
            bytesDownloaded: 0,
            bytesUploaded: 0,
            errors: 0
        };
    }

    log(level, message, data = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            processId: this.processId,
            message,
            ...data
        };
        console.log(JSON.stringify(logEntry));
    }

    async processJob(jobData) {
        this.log('info', 'Starting job processing', { jobData });
        
        try {
            const { eventId, photos } = jobData;
            
            if (!photos || photos.length === 0) {
                throw new Error('No photos to process');
            }

            this.log('info', `Processing ${photos.length} photos for event ${eventId}`);

            // Create temporary directory for processing
            const tempDir = `/tmp/${this.processId}`;
            await this.ensureDirectory(tempDir);

            // Start performance monitoring
            const perfMonitor = setInterval(() => {
                this.logPerformanceStats();
            }, 30000); // Every 30 seconds

            try {
                // Download and process photos in batches
                const zipPath = await this.createOptimizedZip(photos, tempDir, eventId);
                
                // Upload to R2
                const r2Url = await this.uploadToR2(zipPath, eventId);
                
                // Send email notification
                await this.sendEmailNotification(eventId, r2Url, photos.length);
                
                // Cleanup
                await this.cleanup(tempDir);
                
                clearInterval(perfMonitor);
                
                this.log('info', 'Job completed successfully', {
                    eventId,
                    r2Url,
                    stats: this.stats,
                    duration: Date.now() - this.startTime
                });

                return { success: true, eventId, downloadUrl: r2Url };

            } catch (error) {
                clearInterval(perfMonitor);
                throw error;
            }

        } catch (error) {
            this.log('error', 'Job processing failed', { error: error.message, stack: error.stack });
            throw error;
        }
    }

    async createOptimizedZip(photos, tempDir, eventId) {
        const zipPath = path.join(tempDir, `${eventId}-photos.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 1 } // Fast compression for speed
        });

        return new Promise(async (resolve, reject) => {
            output.on('close', () => {
                this.log('info', 'ZIP creation completed', {
                    totalBytes: archive.pointer(),
                    filesCount: this.stats.filesProcessed
                });
                resolve(zipPath);
            });

            output.on('error', reject);
            archive.on('error', reject);

            archive.pipe(output);

            // Process photos in concurrent batches
            const batches = this.createBatches(photos, MAX_CONCURRENT_DOWNLOADS);
            
            for (const batch of batches) {
                await Promise.all(batch.map(photo => this.downloadAndAddToZip(photo, archive)));
            }

            await archive.finalize();
        });
    }

    async downloadAndAddToZip(photo, archive) {
        const startTime = Date.now();
        
        try {
            this.log('info', `Downloading photo: ${photo.filename}`, { 
                url: photo.downloadURL,
                size: photo.size 
            });

            // Configure axios for optimal performance
            const response = await axios({
                method: 'get',
                url: photo.downloadURL,
                responseType: 'stream',
                timeout: 300000, // 5 minutes
                headers: {
                    'User-Agent': 'AWS-Batch-Photo-Processor/1.0'
                },
                // Use HTTP/2 if available and disable compression for speed
                httpAgent: new (require('http').Agent)({ keepAlive: true }),
                httpsAgent: new (require('https').Agent)({ keepAlive: true })
            });

            // Create transform stream for progress tracking
            const progressStream = new stream.Transform({
                transform(chunk, encoding, callback) {
                    this.push(chunk);
                    callback();
                }
            });

            let downloadedBytes = 0;
            progressStream.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                this.stats.bytesDownloaded += chunk.length;
            });

            // Add to ZIP archive with streaming
            archive.append(response.data.pipe(progressStream), { 
                name: photo.filename,
                date: photo.uploadedAt ? new Date(photo.uploadedAt) : new Date()
            });

            // Wait for download to complete
            await new Promise((resolve, reject) => {
                response.data.on('end', resolve);
                response.data.on('error', reject);
            });

            this.stats.filesProcessed++;
            
            const duration = Date.now() - startTime;
            const speed = downloadedBytes / (duration / 1000) / 1024 / 1024; // MB/s
            
            this.log('info', `Photo downloaded successfully`, {
                filename: photo.filename,
                bytes: downloadedBytes,
                duration,
                speed: `${speed.toFixed(2)} MB/s`
            });

        } catch (error) {
            this.stats.errors++;
            this.log('error', `Failed to download photo: ${photo.filename}`, {
                error: error.message,
                url: photo.downloadURL
            });
            
            // Add error placeholder to ZIP instead of failing completely
            const errorContent = `Error downloading ${photo.filename}: ${error.message}`;
            archive.append(Buffer.from(errorContent), { 
                name: `ERROR-${photo.filename}.txt` 
            });
        }
    }

    async uploadToR2(zipPath, eventId) {
        const startTime = Date.now();
        const stats = fs.statSync(zipPath);
        const fileSize = stats.size;
        
        this.log('info', `Starting R2 upload`, {
            zipPath,
            fileSize: `${(fileSize / 1024 / 1024).toFixed(2)} MB`
        });

        const key = `events/${eventId}/${eventId}-photos.zip`;
        
        try {
            // Use multipart upload for large files
            if (fileSize > UPLOAD_PART_SIZE) {
                return await this.multipartUploadToR2(zipPath, key, fileSize);
            } else {
                return await this.simpleUploadToR2(zipPath, key);
            }
        } catch (error) {
            this.log('error', 'R2 upload failed', { error: error.message });
            throw error;
        } finally {
            const duration = Date.now() - startTime;
            const speed = fileSize / (duration / 1000) / 1024 / 1024; // MB/s
            this.log('info', `R2 upload completed`, {
                duration,
                speed: `${speed.toFixed(2)} MB/s`
            });
        }
    }

    async simpleUploadToR2(zipPath, key) {
        const fileStream = fs.createReadStream(zipPath);
        
        const uploadParams = {
            Bucket: R2_BUCKET,
            Key: key,
            Body: fileStream,
            ContentType: 'application/zip',
            Metadata: {
                'processed-by': 'aws-batch-processor',
                'process-id': this.processId,
                'created-at': new Date().toISOString()
            }
        };

        const result = await r2Client.upload(uploadParams).promise();
        return result.Location;
    }

    async multipartUploadToR2(zipPath, key, fileSize) {
        // Initialize multipart upload
        const createParams = {
            Bucket: R2_BUCKET,
            Key: key,
            ContentType: 'application/zip',
            Metadata: {
                'processed-by': 'aws-batch-processor',
                'process-id': this.processId,
                'created-at': new Date().toISOString()
            }
        };

        const multipartUpload = await r2Client.createMultipartUpload(createParams).promise();
        const uploadId = multipartUpload.UploadId;

        try {
            const fileStream = fs.createReadStream(zipPath);
            const parts = [];
            let partNumber = 1;
            let uploadedBytes = 0;

            // Upload parts
            for await (const chunk of this.chunkFileStream(fileStream, UPLOAD_PART_SIZE)) {
                const partParams = {
                    Bucket: R2_BUCKET,
                    Key: key,
                    PartNumber: partNumber,
                    UploadId: uploadId,
                    Body: chunk
                };

                const partResult = await r2Client.uploadPart(partParams).promise();
                parts.push({
                    ETag: partResult.ETag,
                    PartNumber: partNumber
                });

                uploadedBytes += chunk.length;
                this.stats.bytesUploaded += chunk.length;
                
                this.log('info', `Uploaded part ${partNumber}`, {
                    bytes: chunk.length,
                    progress: `${((uploadedBytes / fileSize) * 100).toFixed(2)}%`
                });

                partNumber++;
            }

            // Complete multipart upload
            const completeParams = {
                Bucket: R2_BUCKET,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: { Parts: parts }
            };

            const result = await r2Client.completeMultipartUpload(completeParams).promise();
            return result.Location;

        } catch (error) {
            // Abort multipart upload on error
            await r2Client.abortMultipartUpload({
                Bucket: R2_BUCKET,
                Key: key,
                UploadId: uploadId
            }).promise();
            throw error;
        }
    }

    async *chunkFileStream(stream, chunkSize) {
        let buffer = Buffer.alloc(0);
        
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
            
            while (buffer.length >= chunkSize) {
                yield buffer.slice(0, chunkSize);
                buffer = buffer.slice(chunkSize);
            }
        }
        
        if (buffer.length > 0) {
            yield buffer;
        }
    }

    async sendEmailNotification(eventId, downloadUrl, photoCount) {
        if (!EMAIL_WEBHOOK_URL) {
            this.log('warn', 'No email webhook URL configured');
            return;
        }

        try {
            const emailData = {
                eventId,
                downloadUrl,
                photoCount,
                processedAt: new Date().toISOString(),
                processedBy: 'aws-batch-processor'
            };

            await axios.post(EMAIL_WEBHOOK_URL, emailData, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'AWS-Batch-Photo-Processor/1.0'
                }
            });

            this.log('info', 'Email notification sent successfully');

        } catch (error) {
            this.log('error', 'Failed to send email notification', {
                error: error.message,
                eventId,
                downloadUrl
            });
            // Don't throw - email failure shouldn't fail the job
        }
    }

    createBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    async ensureDirectory(dir) {
        try {
            await fs.promises.mkdir(dir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    async cleanup(tempDir) {
        try {
            await fs.promises.rmdir(tempDir, { recursive: true });
            this.log('info', 'Cleanup completed');
        } catch (error) {
            this.log('warn', 'Cleanup failed', { error: error.message });
        }
    }

    logPerformanceStats() {
        const runtime = Date.now() - this.startTime;
        const memUsage = process.memoryUsage();
        
        this.log('info', 'Performance stats', {
            runtime,
            stats: this.stats,
            memory: {
                rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
                heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
            },
            downloadSpeed: this.stats.bytesDownloaded > 0 ? 
                `${(this.stats.bytesDownloaded / (runtime / 1000) / 1024 / 1024).toFixed(2)} MB/s` : '0 MB/s'
        });
    }
}

// Main execution
async function main() {
    const processor = new HighPerformanceProcessor();
    
    try {
        // Get job data from environment or SQS
        let jobData;
        
        if (process.env.JOB_DATA) {
            // Direct job data (for testing)
            jobData = JSON.parse(process.env.JOB_DATA);
        } else if (process.env.SQS_QUEUE_URL) {
            // Get job from SQS
            jobData = await getJobFromSQS();
        } else {
            throw new Error('No job data source configured');
        }

        const result = await processor.processJob(jobData);
        processor.log('info', 'Main execution completed', result);
        process.exit(0);

    } catch (error) {
        processor.log('error', 'Main execution failed', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

async function getJobFromSQS() {
    const queueUrl = process.env.SQS_QUEUE_URL;
    
    const params = {
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20
    };

    const result = await sqs.receiveMessage(params).promise();
    
    if (!result.Messages || result.Messages.length === 0) {
        throw new Error('No messages in SQS queue');
    }

    const message = result.Messages[0];
    const jobData = JSON.parse(message.Body);

    // Delete message from queue
    await sqs.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle
    }).promise();

    return jobData;
}

// Run if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = { HighPerformanceProcessor };
