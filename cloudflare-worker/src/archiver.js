/**
 * ZIP Archive Creation Module for Cloudflare Workers
 * Creates compressed ZIP files from processed images and videos
 */

/**
 * Create ZIP archive from processed files
 * Uses streaming approach to handle large collections efficiently
 * @param {Array} files - Array of file objects with {fileName, buffer, originalSize, compressedSize}
 * @param {string} requestId - Request ID for logging
 * @returns {ArrayBuffer} - ZIP file buffer
 */
export async function createZipArchive(files, requestId) {
  console.log(`🗜️ Creating ZIP archive [${requestId}] with ${files.length} files`);
  
  try {
    // Use fflate synchronous ZIP creation (compatible with Cloudflare Workers)
    const { zipSync } = await import('fflate');
    
    const zipFiles = {};
    let totalSize = 0;
    
    // Prepare files for ZIP creation
    for (const file of files) {
      // Ensure unique filenames (handle duplicates)
      let fileName = sanitizeFileName(file.fileName);
      let counter = 1;
      const originalName = fileName;
      const lastDotIndex = fileName.lastIndexOf('.');
      const nameWithoutExt = lastDotIndex > -1 ? fileName.substring(0, lastDotIndex) : fileName;
      const extension = lastDotIndex > -1 ? fileName.substring(lastDotIndex) : '';
      
      while (zipFiles[fileName]) {
        fileName = `${nameWithoutExt}_${counter}${extension}`;
        counter++;
      }
      
      // Convert ArrayBuffer to Uint8Array for fflate
      const uint8Array = new Uint8Array(file.buffer);
      zipFiles[fileName] = [uint8Array, { level: 0 }]; // No compression for speed
      totalSize += file.buffer.byteLength;
      
      console.log(`📁 Added to ZIP [${requestId}]: ${fileName} (${(file.buffer.byteLength/1024).toFixed(1)}KB)`);
    }
    
    console.log(`📦 ZIP preparation complete [${requestId}]: ${Object.keys(zipFiles).length} files, ${(totalSize/1024/1024).toFixed(2)}MB total`);
    
    // Create ZIP synchronously (no Worker dependency) - no compression for speed
    console.log(`🔄 Creating ZIP archive [${requestId}]...`);
    const zipData = zipSync(zipFiles, {
      level: 0, // No compression for maximum speed
      mem: 1    // Minimal memory usage for speed
    });
    
    const finalSize = zipData.byteLength;
    const compressionRatio = totalSize > 0 ? ((totalSize - finalSize) / totalSize * 100) : 0;
    
    console.log(`✅ ZIP created [${requestId}]: ${(finalSize/1024/1024).toFixed(2)}MB (${compressionRatio.toFixed(1)}% compression)`);
    
    return zipData.buffer;
    
  } catch (error) {
    console.error(`❌ ZIP archiver error [${requestId}]:`, error);
    throw new Error(`Failed to create ZIP archive: ${error.message}`);
  }
}

/**
 * Sanitize filename for ZIP archive
 * Removes or replaces invalid characters
 * @param {string} fileName - Original filename
 * @returns {string} - Sanitized filename
 */
function sanitizeFileName(fileName) {
  if (!fileName) return 'unnamed_file';
  
  // Replace invalid characters for cross-platform compatibility
  let sanitized = fileName
    .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid characters
    .replace(/[\x00-\x1f\x80-\x9f]/g, '') // Remove control characters
    .replace(/^\.+/, '')           // Remove leading dots
    .replace(/\.+$/, '')           // Remove trailing dots
    .replace(/\s+/g, '_')          // Replace spaces with underscores
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .trim();
  
  // Ensure filename isn't empty
  if (!sanitized) {
    sanitized = 'unnamed_file';
  }
  
  // Limit filename length (255 chars is filesystem limit, but let's be conservative)
  if (sanitized.length > 200) {
    const lastDotIndex = sanitized.lastIndexOf('.');
    if (lastDotIndex > -1) {
      const extension = sanitized.substring(lastDotIndex);
      const nameWithoutExt = sanitized.substring(0, lastDotIndex);
      sanitized = nameWithoutExt.substring(0, 200 - extension.length) + extension;
    } else {
      sanitized = sanitized.substring(0, 200);
    }
  }
  
  return sanitized;
}

/**
 * Estimate ZIP file size before creation
 * Useful for memory planning and user feedback
 * @param {Array} files - Array of file objects
 * @returns {number} - Estimated ZIP size in bytes
 */
export function estimateZipSize(files) {
  let totalSize = 0;
  let estimatedCompression = 0.1; // Default 10% compression for mixed content
  
  for (const file of files) {
    totalSize += file.buffer.byteLength;
    
    // Adjust compression estimate based on file type
    const extension = file.fileName.toLowerCase().split('.').pop();
    if (['jpg', 'jpeg', 'mp4', 'mov', 'webp'].includes(extension)) {
      // Already compressed formats - minimal ZIP compression
      estimatedCompression = Math.max(estimatedCompression, 0.02);
    } else if (['png', 'tiff', 'bmp'].includes(extension)) {
      // Less compressed formats - better ZIP compression
      estimatedCompression = Math.max(estimatedCompression, 0.15);
    }
  }
  
  // Add ZIP overhead (directory structure, metadata)
  const zipOverhead = Math.min(totalSize * 0.01, 1024 * 1024); // Max 1MB overhead
  const estimatedSize = totalSize * (1 - estimatedCompression) + zipOverhead;
  
  return Math.round(estimatedSize);
}

/**
 * Create ZIP with progress callback for large archives
 * @param {Array} files - Array of file objects
 * @param {string} requestId - Request ID for logging
 * @param {Function} progressCallback - Callback function for progress updates
 * @returns {ArrayBuffer} - ZIP file buffer
 */
export async function createZipArchiveWithProgress(files, requestId, progressCallback) {
  console.log(`🗜️ Creating ZIP with progress tracking [${requestId}]`);
  
  try {
    const { zip } = await import('fflate');
    
    const zipFiles = {};
    let totalSize = 0;
    let processedFiles = 0;
    
    // Process files with progress updates
    for (const file of files) {
      const fileName = sanitizeFileName(file.fileName);
      const uint8Array = new Uint8Array(file.buffer);
      zipFiles[fileName] = uint8Array;
      totalSize += file.buffer.byteLength;
      processedFiles++;
      
      // Report progress
      if (progressCallback) {
        progressCallback({
          stage: 'preparing',
          processed: processedFiles,
          total: files.length,
          currentFile: fileName
        });
      }
    }
    
    // Create ZIP with progress
    const zipBuffer = await new Promise((resolve, reject) => {
      zip(zipFiles, { level: 6, mem: 8 }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          if (progressCallback) {
            progressCallback({
              stage: 'complete',
              finalSize: data.byteLength,
              originalSize: totalSize
            });
          }
          resolve(data.buffer);
        }
      });
    });
    
    return zipBuffer;
    
  } catch (error) {
    console.error(`❌ ZIP creation with progress failed [${requestId}]:`, error);
    throw new Error(`Failed to create ZIP archive: ${error.message}`);
  }
}

/**
 * Validate files before ZIP creation
 * @param {Array} files - Array of file objects to validate
 * @returns {Object} - Validation result with errors and warnings
 */
export function validateFilesForZip(files) {
  const errors = [];
  const warnings = [];
  const validFiles = [];
  
  let totalSize = 0;
  const maxZipSize = 4 * 1024 * 1024 * 1024; // 4GB ZIP limit
  const fileNames = new Set();
  
  for (const file of files) {
    // Check required properties
    if (!file.fileName || !file.buffer) {
      errors.push(`Invalid file object: missing fileName or buffer`);
      continue;
    }
    
    // Check file size
    const fileSize = file.buffer.byteLength;
    if (fileSize === 0) {
      warnings.push(`Empty file: ${file.fileName}`);
      continue;
    }
    
    if (fileSize > 2 * 1024 * 1024 * 1024) { // 2GB per file limit
      errors.push(`File too large: ${file.fileName} (${(fileSize/1024/1024/1024).toFixed(2)}GB)`);
      continue;
    }
    
    totalSize += fileSize;
    
    // Check duplicate filenames
    const sanitizedName = sanitizeFileName(file.fileName);
    if (fileNames.has(sanitizedName.toLowerCase())) {
      warnings.push(`Duplicate filename (will be renamed): ${file.fileName}`);
    }
    fileNames.add(sanitizedName.toLowerCase());
    
    validFiles.push(file);
  }
  
  // Check total size
  if (totalSize > maxZipSize) {
    errors.push(`Total size too large: ${(totalSize/1024/1024/1024).toFixed(2)}GB (max 4GB)`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    validFiles,
    totalSize,
    estimatedZipSize: estimateZipSize(validFiles)
  };
}
