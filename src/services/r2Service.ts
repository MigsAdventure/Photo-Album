import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

// R2 Configuration
const R2_CONFIG = {
  accountId: process.env.REACT_APP_R2_ACCOUNT_ID || '',
  accessKeyId: process.env.REACT_APP_R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.REACT_APP_R2_SECRET_ACCESS_KEY || '',
  bucketName: process.env.REACT_APP_R2_BUCKET_NAME || 'sharedmoments-photos-production',
  endpoint: process.env.REACT_APP_R2_ENDPOINT || '',
  publicUrl: process.env.REACT_APP_R2_PUBLIC_URL || 'https://sharedmomentsphotos.socialboostai.com'
};

// Create S3 client for R2
const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_CONFIG.endpoint,
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
  },
});

export interface R2UploadOptions {
  eventId: string;
  fileName: string;
  contentType: string;
}

export interface R2PhotoMetadata {
  id: string;
  key: string;
  url: string;
  eventId: string;
  fileName: string;
  size: number;
  uploadedAt: Date;
}

export class R2Service {
  
  // Generate unique file key for R2
  static generateFileKey(eventId: string, fileName: string): string {
    const fileId = uuidv4();
    const extension = fileName.split('.').pop();
    return `events/${eventId}/photos/${fileId}.${extension}`;
  }
  
  // Get public URL for a file
  static getPublicUrl(key: string): string {
    return `${R2_CONFIG.publicUrl}/${key}`;
  }
  
  // Upload file to R2 (for server-side use)
  static async uploadFile(
    buffer: Buffer, 
    options: R2UploadOptions
  ): Promise<R2PhotoMetadata> {
    const key = this.generateFileKey(options.eventId, options.fileName);
    
    const command = new PutObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: key,
      Body: buffer,
      ContentType: options.contentType,
      Metadata: {
        eventId: options.eventId,
        originalFileName: options.fileName,
        uploadedAt: new Date().toISOString(),
      }
    });
    
    await r2Client.send(command);
    
    return {
      id: key.split('/').pop()?.split('.')[0] || '',
      key,
      url: this.getPublicUrl(key),
      eventId: options.eventId,
      fileName: options.fileName,
      size: buffer.length,
      uploadedAt: new Date()
    };
  }
  
  // Get file from R2
  static async getFile(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: key,
    });
    
    const response = await r2Client.send(command);
    const chunks: Buffer[] = [];
    
    if (response.Body) {
      const stream = response.Body as NodeJS.ReadableStream;
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    }
    
    return Buffer.concat(chunks);
  }
  
  // List files for an event
  static async listEventFiles(eventId: string): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: R2_CONFIG.bucketName,
      Prefix: `events/${eventId}/photos/`,
    });
    
    const response = await r2Client.send(command);
    return response.Contents?.map(obj => obj.Key || '') || [];
  }
  
  // Delete file from R2
  static async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: key,
    });
    
    await r2Client.send(command);
  }
  
  // Validate R2 configuration
  static validateConfig(): boolean {
    return !!(
      R2_CONFIG.accountId &&
      R2_CONFIG.accessKeyId &&
      R2_CONFIG.secretAccessKey &&
      R2_CONFIG.bucketName &&
      R2_CONFIG.endpoint &&
      R2_CONFIG.publicUrl
    );
  }
}

export default R2Service;
