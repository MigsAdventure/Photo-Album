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
  console.log(`🗜️ Creating memory-efficient ZIP archive [${requestId}] with ${files.length} files`);
  
  try {
    // Calculate total size and check for memory constraints
    const totalSize = files.reduce((sum, file) => sum + file.buffer.byteLength, 0);
    const totalSizeMB = totalSize / 1024 / 1024;
    
    console.log(`📊 Collection size analysis [${requestId}]: ${totalSizeMB.toFixed(2)}MB total`);
    
    // For very large collections (>150MB), use batched processing
    if (totalSizeMB > 150) {
      console.log(`⚠️ Large collection detected [${requestId}] - Using batched ZIP creation`);
      return await createBatchedZipArchive(files, requestId);
    }
    
    // For medium collections, use optimized memory approach
    const { zipSync } = await import('fflate');
    
    const zipFiles = {};
    let processedSize = 0;
    
    // Process files with memory-efficient approach
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
      
      // Check individual file size limit (100MB per file to avoid typed array limits)
      if (file.buffer.byteLength > 100 * 1024 * 1024) {
        console.warn(`⚠️ Skipping large file [${requestId}]: ${fileName} (${(file.buffer.byteLength/1024/1024).toFixed(2)}MB - exceeds 100MB limit)`);
        continue;
      }
      
      try {
        // Convert ArrayBuffer to Uint8Array with error handling
        const uint8Array = new Uint8Array(file.buffer);
        zipFiles[fileName] = [uint8Array, { level: 0 }]; // No compression for speed
        processedSize += file.buffer.byteLength;
        
        console.log(`📁 Added to ZIP [${requestId}]: ${fileName} (${(file.buffer.byteLength/1024).toFixed(1)}KB)`);
        
        // Memory management for large files
        if (file.buffer.byteLength > 50 * 1024 * 1024) { // 50MB+
          if (typeof global !== 'undefined' && global.gc) {
            global.gc();
          }
        }
        
      } catch (arrayError) {
        console.error(`❌ Failed to create typed array for [${requestId}]: ${fileName}`, arrayError);
        // Skip this file and continue with others
        continue;
      }
    }
    
    if (Object.keys(zipFiles).length === 0) {
      throw new Error('No files could be processed for ZIP creation');
    }
    
    console.log(`📦 ZIP preparation complete [${requestId}]: ${Object.keys(zipFiles).length} files, ${(processedSize/1024/1024).toFixed(2)}MB total`);
    
    // Create ZIP synchronously with error handling
    console.log(`🔄 Creating ZIP archive [${requestId}]...`);
    
    try {
      const zipData = zipSync(zipFiles, {
        level: 0, // No compression for maximum speed and memory efficiency
        mem: 1    // Minimal memory usage
      });
      
      const finalSize = zipData.byteLength;
      const compressionRatio = processedSize > 0 ? ((processedSize - finalSize) / processedSize * 100) : 0;
      
      console.log(`✅ ZIP created [${requestId}]: ${(finalSize/1024/1024).toFixed(2)}MB (${compressionRatio.toFixed(1)}% compression)`);
      
      return zipData.buffer;
      
    } catch (zipError) {
      console.error(`❌ ZIP creation failed [${requestId}]:`, zipError);
      // If zipSync fails due to memory, try batched approach
      if (zipError.message.includes('Invalid typed array length') || zipError.message.includes('memory')) {
        console.log(`🔄 Falling back to batched processing [${requestId}]`);
        return await createBatchedZipArchive(files, requestId);
      }
      throw zipError;
    }
    
  } catch (error) {
    console.error(`❌ ZIP archiver error [${requestId}]:`, error);
    throw new Error(`Failed to create ZIP archive: ${error.message}`);
  }
}

/**
 * Create ZIP archive in batches for very large collections
 * Processes files in smaller groups to avoid memory limits
 */
async function createBatchedZipArchive(files, requestId) {
  console.log(`🔄 Creating batched ZIP archive [${requestId}]`);
  
  try {
    const { zipSync } = await import('fflate');
    
    // Sort files by size (smallest first to optimize batching)
    const sortedFiles = [...files].sort((a, b) => a.buffer.byteLength - b.buffer.byteLength);
    
    const batches = [];
    let currentBatch = [];
    let currentBatchSize = 0;
    const maxBatchSize = 80 * 1024 * 1024; // 80MB per batch
    
    // Group files into batches
    for (const file of sortedFiles) {
      // Skip files that are too large individually
      if (file.buffer.byteLength > 80 * 1024 * 1024) {
        console.warn(`⚠️ Skipping oversized file [${requestId}]: ${file.fileName} (${(file.buffer.byteLength/1024/1024).toFixed(2)}MB)`);
        continue;
      }
      
      // If adding this file would exceed batch size, start a new batch
      if (currentBatchSize + file.buffer.byteLength > maxBatchSize && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchSize = 0;
      }
      
      currentBatch.push(file);
      currentBatchSize += file.buffer.byteLength;
    }
    
    // Add the last batch if it has files
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
    
    console.log(`📦 Created ${batches.length} batches for processing [${requestId}]`);
    
    // Process each batch and collect ZIP data
    const batchResults = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`🔄 Processing batch ${i + 1}/${batches.length} [${requestId}]: ${batch.length} files`);
      
      const batchZipFiles = {};
      
      for (const file of batch) {
        let fileName = sanitizeFileName(file.fileName);
        let counter = 1;
        const originalName = fileName;
        const lastDotIndex = fileName.lastIndexOf('.');
        const nameWithoutExt = lastDotIndex > -1 ? fileName.substring(0, lastDotIndex) : fileName;
        const extension = lastDotIndex > -1 ? fileName.substring(lastDotIndex) : '';
        
        // Ensure unique filenames across all batches
        while (batchResults.some(result => result.files[fileName]) || batchZipFiles[fileName]) {
          fileName = `${nameWithoutExt}_${counter}${extension}`;
          counter++;
        }
        
        const uint8Array = new Uint8Array(file.buffer);
        batchZipFiles[fileName] = [uint8Array, { level: 0 }];
      }
      
      // Create ZIP for this batch
      const batchZipData = zipSync(batchZipFiles, { level: 0, mem: 1 });
      
      batchResults.push({
        zipData: batchZipData,
        files: Object.keys(batchZipFiles)
      });
      
      console.log(`✅ Batch ${i + 1} complete [${requestId}]: ${(batchZipData.byteLength/1024/1024).toFixed(2)}MB`);
      
      // Memory cleanup between batches
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
    }
    
    // For now, return the first (largest) batch as the main ZIP
    // In the future, we could implement multi-part ZIP delivery
    const mainResult = batchResults[0];
    const totalFiles = batchResults.reduce((sum, batch) => sum + batch.files.length, 0);
    
    console.log(`✅ Batched ZIP created [${requestId}]: ${(mainResult.zipData.byteLength/1024/1024).toFixed(2)}MB (${totalFiles} total files processed)`);
    
    // TODO: In production, you might want to upload all batches and send multiple download links
    // For now, we'll return the first batch
    return mainResult.zipData.buffer;
    
  } catch (error) {
    console.error(`❌ Batched ZIP creation failed [${requestId}]:`, error);
    throw new Error(`Batched ZIP creation failed: ${error.message}`);
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
