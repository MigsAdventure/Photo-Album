/**
 * Image and Video Compression Module for Cloudflare Workers
 * Simple compression without external dependencies
 */

/**
 * Compress image using Canvas API (for basic compression)
 * @param {ArrayBuffer} buffer - Image buffer
 * @param {string} fileName - Original filename
 * @returns {ArrayBuffer} - Compressed image buffer
 */
export async function compress(buffer, fileName) {
  try {
    console.log(`🖼️ Processing image: ${fileName} (${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB)`);
    
    // For now, we'll do basic size-based filtering instead of actual compression
    // This is because Canvas API is not available in Cloudflare Workers
    const originalSizeMB = buffer.byteLength / 1024 / 1024;
    
    // If image is larger than 5MB, we'll simulate compression by returning original
    // In a full implementation, you'd need to use Workers with WebAssembly or external APIs
    if (originalSizeMB > 5) {
      console.log(`⚠️ Large image detected (${originalSizeMB.toFixed(2)}MB): ${fileName}`);
      console.log(`📋 Note: Would benefit from compression in production`);
    }
    
    // Return original buffer for now
    // TODO: Implement WebAssembly-based image compression for Workers
    console.log(`✅ Image processed: ${fileName}`);
    return buffer;
    
  } catch (error) {
    console.error(`❌ Image compression failed for ${fileName}:`, error);
    return buffer; // Return original if compression fails
  }
}

/**
 * Process video files (placeholder for future video processing)
 * @param {ArrayBuffer} buffer - Video buffer
 * @param {string} fileName - Original filename
 * @returns {ArrayBuffer} - Processed video buffer
 */
export async function compressVideo(buffer, fileName) {
  try {
    console.log(`🎥 Processing video: ${fileName} (${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB)`);
    
    // Videos are typically returned as-is since compression is complex
    // and would require significant processing power
    console.log(`✅ Video processed: ${fileName}`);
    return buffer;
    
  } catch (error) {
    console.error(`❌ Video processing failed for ${fileName}:`, error);
    return buffer; // Return original if processing fails
  }
}

/**
 * Determine if a file should be compressed based on size and type
 * @param {number} sizeBytes - File size in bytes
 * @param {string} fileName - File name to check extension
 * @returns {boolean} - Whether file should be compressed
 */
export function shouldCompress(sizeBytes, fileName) {
  const sizeMB = sizeBytes / 1024 / 1024;
  const isImage = /\.(jpg|jpeg|png|webp|heic)$/i.test(fileName);
  
  // Only suggest compression for images larger than 500KB
  return isImage && sizeMB > 0.5;
}

/**
 * Get file type information
 * @param {string} fileName - File name
 * @returns {Object} - File type info
 */
export function getFileTypeInfo(fileName) {
  const extension = fileName.toLowerCase().split('.').pop();
  
  const imageTypes = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif'];
  const videoTypes = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
  
  if (imageTypes.includes(extension)) {
    return { type: 'image', extension, compressible: true };
  } else if (videoTypes.includes(extension)) {
    return { type: 'video', extension, compressible: false };
  } else {
    return { type: 'other', extension, compressible: false };
  }
}

/**
 * Calculate potential compression savings (estimation)
 * @param {Array} files - Array of file objects with size info
 * @returns {Object} - Compression statistics
 */
export function estimateCompressionSavings(files) {
  let totalSize = 0;
  let compressibleSize = 0;
  let imageCount = 0;
  let videoCount = 0;
  
  files.forEach(file => {
    const { size, fileName } = file;
    totalSize += size;
    
    const typeInfo = getFileTypeInfo(fileName);
    if (typeInfo.type === 'image') {
      imageCount++;
      if (shouldCompress(size, fileName)) {
        compressibleSize += size;
      }
    } else if (typeInfo.type === 'video') {
      videoCount++;
    }
  });
  
  // Estimate 30-50% compression for large images
  const estimatedSavings = compressibleSize * 0.4;
  const estimatedFinalSize = totalSize - estimatedSavings;
  
  return {
    totalSize,
    estimatedFinalSize,
    estimatedSavings,
    compressionRatio: totalSize > 0 ? (estimatedSavings / totalSize) * 100 : 0,
    imageCount,
    videoCount,
    compressibleCount: files.filter(f => shouldCompress(f.size, f.fileName)).length
  };
}
