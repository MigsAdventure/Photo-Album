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
 * Create ZIP archive with TRUE streaming using archiver
 * Industry-standard solution for 350MB+ videos
 * @param {Array} photos - Array of photo objects with {fileName, url}
 * @param {string} requestId - Request ID for logging  
 * @returns {Promise<Object>} - { zipBuffer, stats }
 */
async function createStreamingZipArchive(photos, requestId) {
  console.log(`🌊 Creating archiver-based streaming ZIP [${requestId}] with ${photos.length} files`);
  
  try {
    const archiver = (await import('archiver')).default;
    
    let totalOriginalSize = 0;
    let processedFileCount = 0;
    let compressionStats = {
      photosCompressed: 0,
      videosProcessed: 0,
      compressionRatio: 0
    };

    // Create ZIP chunks collection
    const zipChunks = [];
    
    return new Promise(async (resolve, reject) => {
      try {
        // Create archiver instance with no compression for speed
        const archive = archiver('zip', {
          zlib: { level: 0 }, // No compression for large videos
          store: true // Store method for maximum speed
        });

        // Handle archiver events
        archive.on('error', (err) => {
          console.error(`❌ Archive error [${requestId}]:`, err);
          reject(new Error(`Archive creation failed: ${err.message}`));
        });

        archive.on('warning', (warn) => {
          console.warn(`⚠️ Archive warning [${requestId}]:`, warn);
        });

        // Collect ZIP data as it's generated
        archive.on('data', (chunk) => {
          zipChunks.push(chunk);
        });

        archive.on('end', () => {
          try {
            // Combine all chunks into final buffer
            const totalSize = zipChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const finalBuffer = new Uint8Array(totalSize);
            let offset = 0;
            
            for (const chunk of zipChunks) {
              finalBuffer.set(chunk, offset);
              offset += chunk.length;
            }

            const finalSizeMB = totalSize / 1024 / 1024;
            compressionStats.compressionRatio = totalOriginalSize > 0 
              ? ((totalOriginalSize - totalSize) / totalOriginalSize * 100)
              : 0;

            console.log(`✅ Archiver ZIP created [${requestId}]: ${finalSizeMB.toFixed(2)}MB with ${processedFileCount} files`);

            resolve({
              zipBuffer: finalBuffer.buffer,
              stats: {
                processedFileCount,
                totalOriginalSize,
                totalCompressedSize: totalSize,
                compressionStats,
                finalSizeMB
              }
            });
          } catch (finalizationError) {
            console.error(`❌ ZIP finalization error [${requestId}]:`, finalizationError);
            reject(new Error(`ZIP finalization failed: ${finalizationError.message}`));
          }
        });

        // Process each file with true streaming
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

            // For large files: Stream directly using archiver's true streaming
            if (contentLength > 80 * 1024 * 1024) { // Large files: stream
              console.log(`🌊 Streaming large file with archiver [${requestId}]: ${photo.fileName} (${contentLengthMB.toFixed(2)}MB)`);
              
              // Create readable stream from response body
              const readableStream = new ReadableStream({
                start(controller) {
                  const reader = response.body.getReader();
                  
                  function pump() {
                    return reader.read().then(({ done, value }) => {
                      if (done) {
                        controller.close();
                        return;
                      }
                      controller.enqueue(value);
                      return pump();
                    });
                  }
                  
                  return pump();
                }
              });

              // Stream directly to archive (TRUE STREAMING!)
              archive.append(readableStream, { name: sanitizedName });
              
              if (isVideo) {
                compressionStats.videosProcessed++;
              }
              
              console.log(`✅ Large file streamed to archive [${requestId}]: ${photo.fileName}`);
              
            } else { // Small files: process with compression
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

              // Add buffer to archive
              archive.append(processedBuffer, { name: sanitizedName });
              
              console.log(`📁 Added to archive [${requestId}]: ${photo.fileName} (${(processedBuffer.byteLength/1024/1024).toFixed(2)}MB)`);
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

        // Finalize the archive
        console.log(`📦 Finalizing archive [${requestId}] with ${processedFileCount} files...`);
        archive.finalize();

      } catch (setupError) {
        console.error(`❌ Archive setup error [${requestId}]:`, setupError);
        reject(new Error(`Archive setup failed: ${setupError.message}`));
      }
    });

  } catch (error) {
    console.error(`❌ Archiver ZIP creation failed [${requestId}]:`, error);
    throw new Error(`Failed to create archiver ZIP: ${error.message}`);
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
