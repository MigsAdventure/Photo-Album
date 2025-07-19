/**
 * Cloudflare Worker for Wedding Photo Processing
 * Handles large collections with photo compression and long timeouts
 */

import { compress, compressVideo } from './compression';
import { createZipArchive } from './archiver';
import { sendEmail, sendErrorEmail } from './email';

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
    const processedFiles = [];
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    let compressionStats = {
      photosCompressed: 0,
      videosProcessed: 0,
      compressionRatio: 0
    };

    // Process files in batches to manage memory
    const batchSize = 10;
    for (let i = 0; i < photos.length; i += batchSize) {
      const batch = photos.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(photos.length/batchSize)} [${requestId}]`);

      for (const photo of batch) {
        try {
          console.log(`⬇️ Processing file [${requestId}]: ${photo.fileName}`);
          
          // Download file from Firebase Storage
          console.log(`📥 Downloading from Firebase [${requestId}]: ${photo.fileName}`);
          const response = await fetch(photo.url, {
            headers: {
              'User-Agent': 'SharedMoments-Worker/1.0'
            }
          });

          if (!response.ok) {
            console.error(`❌ Failed to download file [${requestId}]: ${photo.fileName} - HTTP ${response.status}`);
            continue;
          }

          const originalBuffer = await response.arrayBuffer();
          const originalSize = originalBuffer.byteLength;
          totalOriginalSize += originalSize;

          let processedBuffer;
          let isCompressed = false;

          // Determine if this is a photo or video
          const isVideo = /\.(mp4|mov|avi|webm)$/i.test(photo.fileName);
          const isPhoto = /\.(jpg|jpeg|png|webp|heic)$/i.test(photo.fileName);

          if (isPhoto && originalSize > 500 * 1024) { // Compress photos > 500KB
            try {
              processedBuffer = await compress(originalBuffer, photo.fileName);
              isCompressed = true;
              compressionStats.photosCompressed++;
              console.log(`📸 Compressed photo [${requestId}]: ${photo.fileName} (${(originalSize/1024/1024).toFixed(2)}MB → ${(processedBuffer.byteLength/1024/1024).toFixed(2)}MB)`);
            } catch (compressionError) {
              console.error(`❌ Compression failed [${requestId}] for ${photo.fileName}:`, compressionError);
              processedBuffer = originalBuffer; // Use original if compression fails
            }
          } else {
            processedBuffer = originalBuffer;
            if (isVideo) {
              compressionStats.videosProcessed++;
            }
          }

          totalCompressedSize += processedBuffer.byteLength;

          processedFiles.push({
            fileName: photo.fileName,
            buffer: processedBuffer,
            originalSize,
            compressedSize: processedBuffer.byteLength,
            isCompressed
          });

        } catch (fileError) {
          console.error(`❌ Failed to process file [${requestId}]: ${photo.fileName}`, fileError);
        }
      }

      // Memory cleanup between batches
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
    }

    if (processedFiles.length === 0) {
      throw new Error('No files were successfully processed');
    }

    // Calculate compression statistics
    compressionStats.compressionRatio = totalOriginalSize > 0 
      ? ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100)
      : 0;

    console.log(`📊 Compression complete [${requestId}]:`, {
      originalSizeMB: (totalOriginalSize / 1024 / 1024).toFixed(2),
      compressedSizeMB: (totalCompressedSize / 1024 / 1024).toFixed(2),
      savingsPercent: compressionStats.compressionRatio.toFixed(1),
      ...compressionStats
    });

    // Create ZIP archive
    console.log(`🗜️ Creating ZIP archive [${requestId}]...`);
    const zipBuffer = await createZipArchive(processedFiles, requestId);
    const finalSizeMB = zipBuffer.byteLength / 1024 / 1024;

    console.log(`📦 ZIP created [${requestId}]: ${finalSizeMB.toFixed(2)}MB`);

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
        photoCount: processedFiles.length.toString(),
        originalSizeMB: (totalOriginalSize / 1024 / 1024).toFixed(2),
        compressedSizeMB: finalSizeMB.toFixed(2),
        compressionRatio: compressionStats.compressionRatio.toFixed(1)
      }
    });

    const downloadUrl = `${env.R2_PUBLIC_URL}/${r2Key}`;
    console.log(`✅ Uploaded to R2 [${requestId}]: ${downloadUrl}`);

    // Send success email
    await sendEmail({
      eventId,
      email,
      requestId,
      fileCount: processedFiles.length,
      originalSizeMB: totalOriginalSize / 1024 / 1024,
      finalSizeMB,
      downloadUrl,
      compressionStats,
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
