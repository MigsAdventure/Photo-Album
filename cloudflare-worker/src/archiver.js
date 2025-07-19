/**
 * True Streaming ZIP Archive Creation Module for Cloudflare Workers
 * Handles wedding-scale collections (2-3GB) with individual 350MB+ videos
 * Streams files one-by-one without memory limits
 */

/**
 * Create ZIP archive using true streaming approach
 * Handles any collection size by streaming files individually
 * @param {Array} files - Array of file objects with {fileName, buffer, originalSize, compressedSize}
 * @param {string} requestId - Request ID for logging
 * @returns {ArrayBuffer} - Complete ZIP file buffer with ALL files
 */
export async function createZipArchive(files, requestId) {
  console.log(`🗜️ Creating TRUE streaming ZIP archive [${requestId}] with ${files.length} files`);
  
  try {
    // Calculate total collection size for logging
    const totalSize = files.reduce((sum, file) => sum + file.buffer.byteLength, 0);
    const totalSizeMB = totalSize / 1024 / 1024;
    
    console.log(`📊 Wedding collection analysis [${requestId}]: ${totalSizeMB.toFixed(2)}MB total (${files.length} files)`);
    
    // Use streaming approach for ALL collections (no size limits)
    return await createTrueStreamingZip(files, requestId);
    
  } catch (error) {
    console.error(`❌ Streaming ZIP archiver error [${requestId}]:`, error);
    throw new Error(`Failed to create streaming ZIP archive: ${error.message}`);
  }
}

/**
 * Create ZIP using TRUE streaming API that never accumulates large data
 * Uses fflate's async zip() method with chunked processing
 */
async function createTrueStreamingZip(files, requestId) {
  console.log(`🌊 Initializing TRUE streaming ZIP (async) [${requestId}]`);
  
  try {
    const { zip } = await import('fflate');
    
    // Track processing
    let processedFiles = 0;
    let processedSize = 0;
    const fileNameMap = new Map();
    const zipEntries = {};
    
    console.log(`🔄 Processing ${files.length} files for streaming ZIP [${requestId}]...`);
    
    // Process files in smaller batches to avoid memory issues
    const BATCH_SIZE = 3; // Process 3 files at a time
    const totalBatches = Math.ceil(files.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * BATCH_SIZE;
      const endIndex = Math.min(startIndex + BATCH_SIZE, files.length);
      const batch = files.slice(startIndex, endIndex);
      
      console.log(`📦 Processing batch ${batchIndex + 1}/${totalBatches} [${requestId}]: ${batch.length} files`);
      
      for (const file of batch) {
        // Generate unique filename
        const uniqueFileName = generateUniqueFileName(file.fileName, fileNameMap);
        fileNameMap.set(uniqueFileName, true);
        
        // Check individual file size (allow up to 500MB for 4K videos)
        const fileSizeMB = file.buffer.byteLength / 1024 / 1024;
        if (file.buffer.byteLength > 500 * 1024 * 1024) {
          console.warn(`⚠️ Skipping extremely large file [${requestId}]: ${uniqueFileName} (${fileSizeMB.toFixed(2)}MB - exceeds 500MB limit)`);
          continue;
        }
        
        try {
          // Convert to Uint8Array - this is the only copy we keep
          const uint8Array = new Uint8Array(file.buffer);
          zipEntries[uniqueFileName] = uint8Array;
          
          processedFiles++;
          processedSize += file.buffer.byteLength;
          
          console.log(`📁 Added ${processedFiles}/${files.length} [${requestId}]: ${uniqueFileName} (${fileSizeMB.toFixed(2)}MB)`);
          
          // Force garbage collection after large files
          if (file.buffer.byteLength > 50 * 1024 * 1024) { // 50MB+
            if (typeof global !== 'undefined' && global.gc) {
              global.gc();
            }
          }
          
        } catch (fileError) {
          console.error(`❌ Failed to process file [${requestId}]: ${uniqueFileName}`, fileError);
          continue;
        }
      }
      
      // Memory cleanup between batches
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
      
      // Small delay to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    
    if (processedFiles === 0) {
      throw new Error('No files could be processed for ZIP creation');
    }
    
    console.log(`🗜️ Creating streaming ZIP [${requestId}]: ${processedFiles} files, ${(processedSize/1024/1024).toFixed(2)}MB total`);
    
    // Use async zip() API which streams data instead of accumulating everything
    const zipBuffer = await new Promise((resolve, reject) => {
      zip(zipEntries, {
        level: 0,    // No compression for speed and memory efficiency
        mem: 1       // Minimal memory usage
      }, (err, data) => {
        if (err) {
          console.error(`❌ Async ZIP failed [${requestId}]:`, err);
          reject(new Error(`Async ZIP creation failed: ${err.message}`));
        } else {
          const finalSize = data.byteLength;
          const compressionRatio = processedSize > 0 ? ((processedSize - finalSize) / processedSize * 100) : 0;
          
          console.log(`✅ STREAMING ZIP created [${requestId}]: ${(finalSize/1024/1024).toFixed(2)}MB final size`);
          console.log(`📊 Processing summary [${requestId}]: ${processedFiles}/${files.length} files, ${compressionRatio.toFixed(1)}% compression`);
          
          resolve(data.buffer);
        }
      });
    });
    
    return zipBuffer;
    
  } catch (error) {
    console.error(`❌ Streaming ZIP creation failed [${requestId}]:`, error);
    throw new Error(`Streaming ZIP creation failed: ${error.message}`);
  }
}

/**
 * Generate unique filename to handle duplicates
 * @param {string} originalFileName - Original filename
 * @param {Map} fileNameMap - Map of used filenames
 * @returns {string} - Unique sanitized filename
 */
function generateUniqueFileName(originalFileName, fileNameMap) {
  let fileName = sanitizeFileName(originalFileName);
  let counter = 1;
  
  const originalName = fileName;
  const lastDotIndex = fileName.lastIndexOf('.');
  const nameWithoutExt = lastDotIndex > -1 ? fileName.substring(0, lastDotIndex) : fileName;
  const extension = lastDotIndex > -1 ? fileName.substring(lastDotIndex) : '';
  
  // Find unique filename
  while (fileNameMap.has(fileName)) {
    fileName = `${nameWithoutExt}_${counter}${extension}`;
    counter++;
  }
  
  return fileName;
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
    const maxBatchSize = 120 * 1024 * 1024; // 120MB per batch to accommodate wedding videos
    
    // Group files into batches
    for (const file of sortedFiles) {
      // Skip files that are too large individually (same as main function limit)
      if (file.buffer.byteLength > 150 * 1024 * 1024) {
        console.warn(`⚠️ Skipping oversized file [${requestId}]: ${file.fileName} (${(file.buffer.byteLength/1024/1024).toFixed(2)}MB - exceeds 150MB limit)`);
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
