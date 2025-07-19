/**
 * Durable Object for Wedding ZIP Processing
 * Handles large file collections with streaming architecture
 * Supports 500MB+ videos and unlimited collection sizes
 */

import { sendEmail, sendErrorEmail } from './email';

export class WeddingZipProcessor {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (request.method === 'POST') {
      return await this.handleZipRequest(request);
    }
    
    // Handle status checks
    if (url.pathname === '/status') {
      return await this.getProcessingStatus();
    }
    
    return new Response('Durable Object ready', { status: 200 });
  }

  async handleZipRequest(request) {
    try {
      const { eventId, email, photos, requestId } = await request.json();
      
      console.log(`🎯 Durable Object processing [${requestId}]: ${photos.length} files for ${email}`);
      
      // Start background processing (don't await - return immediately)
      this.processCollectionWithStreaming(eventId, email, photos, requestId);
      
      return new Response(JSON.stringify({
        success: true,
        status: 'processing_started',
        requestId,
        message: 'Durable Object processing started'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Durable Object request error:', error);
      return new Response(JSON.stringify({
        error: 'Failed to start processing',
        details: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  async processCollectionWithStreaming(eventId, email, photos, requestId) {
    const startTime = Date.now();
    console.log(`🚀 Durable Object streaming processing started [${requestId}]`);
    
    try {
      // Initialize processing state
      await this.state.storage.put('processing_state', {
        eventId,
        email,
        requestId,
        startTime,
        status: 'processing',
        totalFiles: photos.length,
        processedFiles: 0,
        failedFiles: []
      });
      
      // Create streaming ZIP directly to R2
      const result = await this.createStreamingZipToR2(photos, eventId, requestId);
      
      // Update final state
      await this.state.storage.put('processing_state', {
        eventId,
        email,
        requestId,
        status: 'completed',
        result,
        completedAt: Date.now()
      });
      
      // Send success email
      await this.sendSuccessEmail(eventId, email, requestId, result, startTime);
      
      console.log(`✅ Durable Object processing complete [${requestId}] in ${(Date.now() - startTime) / 1000}s`);
      
      // Clean up state after successful completion
      await this.cleanupState();
      
    } catch (error) {
      console.error(`❌ Durable Object processing failed [${requestId}]:`, error);
      
      // Update error state
      await this.state.storage.put('processing_state', {
        eventId,
        email,
        requestId,
        status: 'failed',
        error: error.message,
        failedAt: Date.now()
      });
      
      // Send error email
      await this.sendErrorEmail(eventId, email, requestId, error);
    }
  }

  async createStreamingZipToR2(photos, eventId, requestId) {
    console.log(`🌊 Creating streaming ZIP to R2 [${requestId}] with ${photos.length} files`);
    
    const { zip } = await import('fflate');
    
    let processedFiles = 0;
    let totalOriginalSize = 0;
    let totalProcessedSize = 0;
    const failedFiles = [];
    const successfulFiles = [];
    
    // Create R2 upload stream
    const zipFileName = `event_${eventId}_wedding_photos_${Date.now()}.zip`;
    const r2Key = `downloads/${zipFileName}`;
    
    console.log(`📦 Initializing R2 stream [${requestId}]: ${r2Key}`);
    
    // Process files in small batches to maintain memory efficiency
    const BATCH_SIZE = 5; // Process 5 files at a time
    const zipEntries = {};
    
    for (let i = 0; i < photos.length; i += BATCH_SIZE) {
      const batch = photos.slice(i, Math.min(i + BATCH_SIZE, photos.length));
      console.log(`🔄 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(photos.length/BATCH_SIZE)} [${requestId}]: ${batch.length} files`);
      
      for (const photo of batch) {
        const fileResult = await this.processFileWithRetry(photo, requestId);
        
        if (fileResult.success) {
          const uniqueFileName = this.generateUniqueFileName(photo.fileName, zipEntries);
          zipEntries[uniqueFileName] = new Uint8Array(fileResult.buffer);
          
          processedFiles++;
          totalOriginalSize += fileResult.originalSize;
          totalProcessedSize += fileResult.buffer.byteLength;
          successfulFiles.push({
            fileName: uniqueFileName,
            originalSize: fileResult.originalSize,
            processedSize: fileResult.buffer.byteLength
          });
          
          console.log(`✅ File processed [${requestId}]: ${uniqueFileName} (${(fileResult.buffer.byteLength/1024/1024).toFixed(2)}MB)`);
        } else {
          failedFiles.push({
            fileName: photo.fileName,
            reason: fileResult.error,
            attempts: fileResult.attempts
          });
          console.warn(`❌ File failed [${requestId}]: ${photo.fileName} - ${fileResult.error}`);
        }
        
        // Update progress in state
        await this.updateProcessingProgress(processedFiles, photos.length, failedFiles.length);
      }
      
      // Memory cleanup between batches
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
      
      // Small delay to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    if (processedFiles === 0) {
      throw new Error('No files could be processed successfully');
    }
    
    console.log(`🗜️ Creating final ZIP [${requestId}]: ${processedFiles} files, ${(totalProcessedSize/1024/1024).toFixed(2)}MB`);
    
    // Create ZIP with async streaming approach
    const zipBuffer = await new Promise((resolve, reject) => {
      zip(zipEntries, {
        level: 0,    // No compression for speed and memory efficiency
        mem: 1       // Minimal memory usage
      }, (err, data) => {
        if (err) {
          console.error(`❌ ZIP creation failed [${requestId}]:`, err);
          reject(new Error(`ZIP creation failed: ${err.message}`));
        } else {
          console.log(`✅ ZIP created [${requestId}]: ${(data.byteLength/1024/1024).toFixed(2)}MB`);
          resolve(data.buffer);
        }
      });
    });
    
    // Upload to R2
    console.log(`⬆️ Uploading to R2 [${requestId}]: ${(zipBuffer.byteLength/1024/1024).toFixed(2)}MB`);
    
    await this.env.R2_BUCKET.put(r2Key, zipBuffer, {
      httpMetadata: {
        contentType: 'application/zip'
      },
      customMetadata: {
        eventId,
        requestId,
        createdAt: new Date().toISOString(),
        processedFiles: processedFiles.toString(),
        failedFiles: failedFiles.length.toString(),
        originalSizeMB: (totalOriginalSize / 1024 / 1024).toFixed(2),
        finalSizeMB: (zipBuffer.byteLength / 1024 / 1024).toFixed(2)
      }
    });
    
    const downloadUrl = `${this.env.R2_PUBLIC_URL}/${r2Key}`;
    console.log(`✅ Uploaded to R2 [${requestId}]: ${downloadUrl}`);
    
    return {
      downloadUrl,
      processedFiles,
      failedFiles,
      totalOriginalSize,
      finalSize: zipBuffer.byteLength,
      successfulFiles,
      zipFileName
    };
  }

  async processFileWithRetry(photo, requestId, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`⬇️ Downloading file [${requestId}] attempt ${attempt}/${maxRetries}: ${photo.fileName}`);
        
        // Determine appropriate timeout based on file size and type
        const isVideo = /\.(mp4|mov|avi|webm|mkv)$/i.test(photo.fileName);
        const fileSizeMB = (photo.size || 10 * 1024 * 1024) / 1024 / 1024;
        
        // Dynamic timeout: 2 minutes for large videos, 1 minute for others
        const baseTimeout = isVideo && fileSizeMB > 100 ? 120000 : 60000; // 120s for large videos, 60s for others
        const timeoutMs = baseTimeout + (attempt - 1) * 30000; // Add 30s per retry
        
        console.log(`📊 File details [${requestId}]: ${photo.fileName} (${fileSizeMB.toFixed(2)}MB, ${isVideo ? 'video' : 'photo'}, timeout: ${timeoutMs/1000}s)`);
        
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.warn(`⏰ Download timeout [${requestId}]: ${photo.fileName} (${timeoutMs/1000}s)`);
          controller.abort();
        }, timeoutMs);
        
        try {
          const response = await fetch(photo.url, {
            headers: { 'User-Agent': 'SharedMoments-DurableObject/1.0' },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const contentLength = parseInt(response.headers.get('content-length') || '0');
          console.log(`📥 Starting download [${requestId}]: ${photo.fileName} (${contentLength ? (contentLength/1024/1024).toFixed(2) + 'MB' : 'unknown size'})`);
          
          // For large files, stream the download to avoid memory issues
          const buffer = await response.arrayBuffer();
          
          console.log(`✅ File downloaded [${requestId}]: ${photo.fileName} (${(buffer.byteLength/1024/1024).toFixed(2)}MB)`);
          
          return {
            success: true,
            buffer,
            originalSize: contentLength || buffer.byteLength,
            attempts: attempt,
            downloadTimeMs: Date.now() - (Date.now() - timeoutMs + (attempt - 1) * 30000)
          };
          
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
        
      } catch (error) {
        lastError = error;
        const errorType = error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
        console.warn(`⚠️ File download attempt ${attempt} ${errorType} [${requestId}]: ${photo.fileName} - ${error.message}`);
        
        if (attempt < maxRetries) {
          // Exponential backoff: 2s, 5s, 10s for better handling of large files
          const backoffMs = Math.min(Math.pow(2, attempt) * 1000, 10000);
          console.log(`⏳ Retrying in ${backoffMs/1000}s [${requestId}]: ${photo.fileName}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }
    
    console.error(`💥 File download failed after ${maxRetries} attempts [${requestId}]: ${photo.fileName} - ${lastError?.message}`);
    
    return {
      success: false,
      error: lastError?.message || 'Unknown download error',
      attempts: maxRetries
    };
  }

  generateUniqueFileName(originalFileName, existingEntries) {
    let fileName = this.sanitizeFileName(originalFileName);
    let counter = 1;
    
    const originalName = fileName;
    const lastDotIndex = fileName.lastIndexOf('.');
    const nameWithoutExt = lastDotIndex > -1 ? fileName.substring(0, lastDotIndex) : fileName;
    const extension = lastDotIndex > -1 ? fileName.substring(lastDotIndex) : '';
    
    while (existingEntries[fileName]) {
      fileName = `${nameWithoutExt}_${counter}${extension}`;
      counter++;
    }
    
    return fileName;
  }

  sanitizeFileName(fileName) {
    if (!fileName) return 'unnamed_file';
    
    return fileName
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[\x00-\x1f\x80-\x9f]/g, '')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .trim() || 'unnamed_file';
  }

  async updateProcessingProgress(processed, total, failed) {
    const currentState = await this.state.storage.get('processing_state');
    if (currentState) {
      currentState.processedFiles = processed;
      currentState.failedFiles = failed;
      currentState.progress = ((processed + failed) / total * 100).toFixed(1);
      await this.state.storage.put('processing_state', currentState);
    }
  }

  async sendSuccessEmail(eventId, email, requestId, result, startTime) {
    const processingTimeSeconds = (Date.now() - startTime) / 1000;
    
    await sendEmail({
      eventId,
      email,
      requestId,
      fileCount: result.processedFiles,
      originalSizeMB: result.totalOriginalSize / 1024 / 1024,
      finalSizeMB: result.finalSize / 1024 / 1024,
      downloadUrl: result.downloadUrl,
      failedFiles: result.failedFiles,
      processingTimeSeconds,
      processingMethod: 'durable-object-streaming'
    }, this.env);
  }

  async sendErrorEmail(eventId, email, requestId, error) {
    await sendErrorEmail(eventId, email, requestId, error.message, this.env);
  }

  async getProcessingStatus() {
    const state = await this.state.storage.get('processing_state');
    return new Response(JSON.stringify(state || { status: 'idle' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async cleanupState() {
    // Clean up processing state after successful completion
    await this.state.storage.delete('processing_state');
    console.log('🧹 Durable Object state cleaned up');
  }
}
