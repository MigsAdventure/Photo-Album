/**
 * Cloudflare Worker for Wedding Photo Processing
 * Handles large collections with photo compression and long timeouts
 */

import { compress, compressVideo } from './compression';
import { createZipArchive } from './archiver';
import { sendEmail, sendErrorEmail } from './email';

/**
 * Stream large files directly to ZIP without holding full file in memory
 * @param {Response} response - Fetch response object  
 * @param {number} contentLength - Total file size in bytes
 * @param {string} fileName - File name for ZIP entry
 * @param {object} zipStream - fflate ZIP stream object
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<number>} - Total bytes processed
 */
async function streamFileToZip(response, contentLength, fileName, zipStream, requestId) {
  const chunkSize = 10 * 1024 * 1024; // 10MB chunks for optimal memory usage
  let totalBytesRead = 0;
  
  console.log(`🌊 Starting direct streaming to ZIP [${requestId}]: ${fileName} (${(contentLength/1024/1024).toFixed(2)}MB)`);
  
  try {
    const reader = response.body.getReader();
    let isFirstChunk = true;
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log(`✅ Direct streaming complete [${requestId}]: ${fileName} (${totalBytesRead} bytes)`);
        break;
      }
      
      // Stream chunk directly to ZIP (never accumulate in memory)
      if (isFirstChunk) {
        // Start the ZIP entry with first chunk
        zipStream.add(fileName, value, { level: 0 });
        isFirstChunk = false;
      } else {
        // Continue streaming subsequent chunks
        zipStream.push(value);
      }
      
      totalBytesRead += value.byteLength;
      
      // Log progress every 50MB
      if (totalBytesRead % (50 * 1024 * 1024) < value.byteLength) {
        const progressPercent = (totalBytesRead / contentLength * 100).toFixed(1);
        console.log(`📊 Streaming progress [${requestId}]: ${fileName} ${progressPercent}% (${(totalBytesRead/1024/1024).toFixed(2)}MB/${(contentLength/1024/1024).toFixed(2)}MB)`);
      }
      
      // Memory management - force garbage collection for large chunks
      if (value.byteLength > 20 * 1024 * 1024) { // 20MB+ chunks
        if (typeof global !== 'undefined' && global.gc) {
          global.gc();
        }
      }
      
      // Yield control periodically to prevent blocking
      if (totalBytesRead % (30 * 1024 * 1024) < value.byteLength) { // Every 30MB
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
    
    // Finalize this file's ZIP entry
    zipStream.end(fileName);
    
    return totalBytesRead;
    
  } catch (error) {
    console.error(`❌ Direct streaming failed [${requestId}]: ${fileName}`, error);
    throw new Error(`Failed to stream file to ZIP: ${error.message}`);
  }
}

/**
 * Download smaller files normally (under memory limit)
 * @param {Response} response - Fetch response object
 * @param {string} requestId - Request ID for logging
 * @param {string} fileName - File name for logging
 * @returns {ArrayBuffer} - Complete file buffer
 */
async function downloadSmallFile(response, requestId, fileName) {
  try {
    console.log(`📥 Direct download [${requestId}]: ${fileName}`);
    const buffer = await response.arrayBuffer();
    console.log(`✅ Download complete [${requestId}]: ${fileName} (${(buffer.byteLength/1024/1024).toFixed(2)}MB)`);
    return buffer;
  } catch (error) {
    console.error(`❌ Direct download failed [${requestId}]: ${fileName}`, error);
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

/**
 * Create ZIP archive with TRUE streaming for large files
 * Downloads files in chunks and streams directly to ZIP
 * Creates single ZIP with complete 500MB+ video files
 * @param {Array} photos - Array of photo objects with {fileName, url}
 * @param {string} requestId - Request ID for logging  
 * @returns {Promise<Object>} - { zipBuffer, stats }
 */
async function createStreamingZipArchive(photos, requestId) {
  console.log(`🌊 Creating TRUE streaming ZIP [${requestId}] with ${photos.length} files`);
  
  try {
    const { Zip } = await import('fflate');
    
    let totalOriginalSize = 0;
    let totalFinalSize = 0;
    let processedFileCount = 0;
    let compressionStats = {
      photosCompressed: 0,
      videosProcessed: 0,
      compressionRatio: 0
    };

    // Create streaming ZIP with collected chunks
    const zipChunks = [];
    
    return new Promise(async (resolve, reject) => {
      try {
        // Create ZIP stream that collects output chunks
        const zip = new Zip((err, data) => {
          if (err) {
            console.error(`❌ ZIP stream error [${requestId}]:`, err);
            reject(new Error(`ZIP streaming failed: ${err.message}`));
            return;
          }
          
          // Collect ZIP output chunks
          zipChunks.push(data);
          totalFinalSize += data.byteLength;
        });

        // Process each file with streaming
        for (const photo of photos) {
          try {
            console.log(`⬇️ Processing file [${requestId}]: ${photo.fileName}`);
            
            // Download file from Firebase
            const response = await fetch(photo.url, {
              headers: { 'User-Agent': 'SharedMoments-Worker/1.0' }
            });

            if (!response.ok) {
              console.error(`❌ Failed to download [${requestId}]: ${photo.fileName} - HTTP ${response.status}`);
              continue;
            }

            // Get file size
            const contentLength = parseInt(response.headers.get('content-length') || '0');
            const contentLengthMB = contentLength / 1024 / 1024;
            
            console.log(`📊 File size [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB)`);
            totalOriginalSize += contentLength;

            // Determine file type
            const isVideo = /\.(mp4|mov|avi|webm)$/i.test(photo.fileName);
            const isPhoto = /\.(jpg|jpeg|png|webp|heic)$/i.test(photo.fileName);
            
            const sanitizedName = sanitizeFileName(photo.fileName);

            // Stream large files directly to ZIP
            if (contentLength > 80 * 1024 * 1024) { // Large files: stream
              console.log(`🌊 Streaming large file to ZIP [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB)`);
              
              await streamFileDirectlyToZip(response, contentLength, sanitizedName, zip, requestId);
              
              if (isVideo) {
                compressionStats.videosProcessed++;
              }
              
            } else { // Small files: process normally
              const buffer = await downloadSmallFile(response, requestId, photo.fileName);
              
              let processedBuffer = buffer;

              // Compress photos if beneficial
              if (isPhoto && buffer.byteLength > 500 * 1024) {
                try {
                  processedBuffer = await compress(buffer, photo.fileName);
                  compressionStats.photosCompressed++;
                  console.log(`📸 Compressed photo [${requestId}]: ${photo.fileName} (${(buffer.byteLength/1024/1024).toFixed(2)}MB → ${(processedBuffer.byteLength/1024/1024).toFixed(2)}MB)`);
                } catch (compressionError) {
                  console.error(`❌ Compression failed [${requestId}]: ${photo.fileName}`, compressionError);
                  processedBuffer = buffer;
                }
              } else if (isVideo) {
                compressionStats.videosProcessed++;
              }

              // Add to ZIP stream
              const uint8Array = new Uint8Array(processedBuffer);
              zip.add(sanitizedName, uint8Array, { level: 0 });
              
              console.log(`📁 Added to ZIP [${requestId}]: ${photo.fileName} (${(processedBuffer.byteLength/1024/1024).toFixed(2)}MB)`);
            }

            processedFileCount++;

            // Memory cleanup
            if (typeof global !== 'undefined' && global.gc) {
              global.gc();
            }

          } catch (fileError) {
            console.error(`❌ Failed to process file [${requestId}]: ${photo.fileName}`, fileError);
            continue;
          }
        }

        if (processedFileCount === 0) {
          reject(new Error('No files were successfully processed'));
          return;
        }

        // Finalize ZIP
        console.log(`📦 Finalizing ZIP [${requestId}] with ${processedFileCount} files...`);
        zip.end();

        // Wait for ZIP completion
        zip.terminate = () => {
          try {
            // Combine all ZIP chunks
            const totalBufferSize = zipChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const finalBuffer = new Uint8Array(totalBufferSize);
            let offset = 0;
            
            for (const chunk of zipChunks) {
              finalBuffer.set(chunk, offset);
              offset += chunk.byteLength;
            }

            const finalSizeMB = totalBufferSize / 1024 / 1024;
            compressionStats.compressionRatio = totalOriginalSize > 0 
              ? ((totalOriginalSize - totalBufferSize) / totalOriginalSize * 100)
              : 0;

            console.log(`✅ ZIP created [${requestId}]: ${finalSizeMB.toFixed(2)}MB with ${processedFileCount} files`);

            resolve({
              zipBuffer: finalBuffer.buffer,
              stats: {
                processedFileCount,
                totalOriginalSize,
                totalCompressedSize: totalBufferSize,
                compressionStats,
                finalSizeMB
              }
            });

          } catch (finalizationError) {
            console.error(`❌ ZIP finalization error [${requestId}]:`, finalizationError);
            reject(new Error(`ZIP finalization failed: ${finalizationError.message}`));
          }
        };

      } catch (streamError) {
        console.error(`❌ ZIP streaming setup error [${requestId}]:`, streamError);
        reject(new Error(`ZIP streaming setup failed: ${streamError.message}`));
      }
    });

  } catch (error) {
    console.error(`❌ Streaming ZIP creation failed [${requestId}]:`, error);
    throw new Error(`Failed to create streaming ZIP: ${error.message}`);
  }
}

/**
 * Stream large file directly to ZIP without holding in memory
 * Downloads in chunks and feeds directly to ZIP stream
 * @param {Response} response - Fetch response object  
 * @param {number} contentLength - Total file size in bytes
 * @param {string} fileName - Sanitized file name for ZIP entry
 * @param {object} zipStream - fflate ZIP stream object
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<void>}
 */
async function streamFileDirectlyToZip(response, contentLength, fileName, zipStream, requestId) {
  const chunkSize = 10 * 1024 * 1024; // 10MB chunks
  let totalBytesRead = 0;
  let isFirstChunk = true;
  
  console.log(`🌊 Starting direct streaming [${requestId}]: ${fileName} (${(contentLength/1024/1024).toFixed(2)}MB)`);
  
  try {
    const reader = response.body.getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log(`✅ Streaming complete [${requestId}]: ${fileName} (${totalBytesRead} bytes)`);
        break;
      }
      
      // Stream chunk directly to ZIP
      if (isFirstChunk) {
        // Start the ZIP file entry
        zipStream.add(fileName, value, { level: 0 });
        isFirstChunk = false;
      } else {
        // Continue streaming chunks to same file entry
        zipStream.push(fileName, value);
      }
      
      totalBytesRead += value.byteLength;
      
      // Log progress every 50MB
      if (totalBytesRead % (50 * 1024 * 1024) < value.byteLength) {
        const progressPercent = (totalBytesRead / contentLength * 100).toFixed(1);
        console.log(`📊 Streaming progress [${requestId}]: ${fileName} ${progressPercent}% (${(totalBytesRead/1024/1024).toFixed(2)}MB/${(contentLength/1024/1024).toFixed(2)}MB)`);
      }
      
      // Yield control periodically
      if (totalBytesRead % (30 * 1024 * 1024) < value.byteLength) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
    
    // Finalize this file entry in ZIP
    zipStream.end(fileName);
    
  } catch (error) {
    console.error(`❌ Direct streaming failed [${requestId}]: ${fileName}`, error);
    throw new Error(`Failed to stream file to ZIP: ${error.message}`);
  }
}

/**
 * Sanitize filename for ZIP archive
 */
function sanitizeFileName(fileName) {
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

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const { eventId, email, photos, requestId } = body;

      if (!eventId || !email || !photos || !Array.isArray(photos)) {
        return new Response(JSON.stringify({ 
          error: 'Missing required fields: eventId, email, photos' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`🚀 Worker processing [${requestId}]: ${photos.length} files for ${email}`);

      // Start background processing (don't wait for completion)
      ctx.waitUntil(processCollectionInBackground(eventId, email, photos, requestId, env));

      // Return immediate response
      return new Response(JSON.stringify({
        success: true,
        message: `Processing ${photos.length} files with compression. Email will be sent when complete.`,
        requestId,
        estimatedTime: '2-5 minutes',
        processing: 'worker-background'
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

async function processCollectionInBackground(eventId, email, photos, requestId, env) {
  const startTime = Date.now();
  console.log(`🔄 Background processing started [${requestId}]`);

  try {
    // Use streaming ZIP creation to avoid memory limits
    console.log(`🌊 Initializing streaming ZIP creation [${requestId}] for ${photos.length} files`);
    const result = await createStreamingZipArchive(photos, requestId);
    const { zipBuffer, stats } = result;
    const finalSizeMB = stats.finalSizeMB;

    console.log(`📦 Streaming ZIP created [${requestId}]: ${finalSizeMB.toFixed(2)}MB`);

    // Upload to R2
    const zipFileName = `event_${eventId}_compressed_photos_${Date.now()}.zip`;
    const r2Key = `downloads/${zipFileName}`;
    
    await env.R2_BUCKET.put(r2Key, zipBuffer, {
      httpMetadata: {
        contentType: 'application/zip'
      },
      customMetadata: {
        eventId,
        email,
        requestId,
        createdAt: new Date().toISOString(),
        photoCount: stats.processedFileCount.toString(),
        originalSizeMB: (stats.totalOriginalSize / 1024 / 1024).toFixed(2),
        compressedSizeMB: finalSizeMB.toFixed(2),
        compressionRatio: stats.compressionStats.compressionRatio.toFixed(1)
      }
    });

    const downloadUrl = `${env.R2_PUBLIC_URL}/${r2Key}`;
    console.log(`✅ Uploaded to R2 [${requestId}]: ${downloadUrl}`);

    // Send success email
    await sendEmail({
      eventId,
      email,
      requestId,
      fileCount: stats.processedFileCount,
      originalSizeMB: stats.totalOriginalSize / 1024 / 1024,
      finalSizeMB,
      downloadUrl,
      compressionStats: stats.compressionStats,
      processingTimeSeconds: (Date.now() - startTime) / 1000
    }, env);

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`✅ Background processing complete [${requestId}] in ${totalTime.toFixed(1)}s`);

  } catch (error) {
    console.error(`❌ Background processing failed [${requestId}]:`, error);
    
    try {
      await sendErrorEmail(eventId, email, requestId, error.message, env);
    } catch (emailError) {
      console.error(`❌ Failed to send error email [${requestId}]:`, emailError);
    }
  }
}
