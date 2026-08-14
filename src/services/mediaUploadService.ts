// Unified media upload service that handles both photos and videos
import { uploadMediaToR2 } from './r2UploadService';
import { analyzeVideoFile, validateVideoFile } from './videoService';
import { FileAnalysis } from '../types';

// Detect if file is a video
const isVideoFile = (file: File): boolean => {
  // Check MIME type - MP4 files can have various MIME types
  const videoMimeTypes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime', // .mov files
    'video/webm',
    'video/x-msvideo', // .avi files
    'application/mp4', // Some MP4 files use this
    'video/3gpp',
    'video/x-ms-wmv'
  ];
  
  if (videoMimeTypes.includes(file.type)) {
    return true;
  }
  
  // Fallback to file extension if MIME type is missing/unknown
  return file.name.toLowerCase().match(/\.(mp4|mov|webm|avi|3gp|wmv)$/) !== null;
};

// Detect if file is an image
const isImageFile = (file: File): boolean => {
  return file.type.startsWith('image/') || 
         file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|heic|heif)$/) !== null;
};

// Unified file analysis that works for both photos and videos
export const analyzeMediaFile = async (file: File): Promise<FileAnalysis> => {
  if (isVideoFile(file)) {
    console.log('🎥 Analyzing video file:', file.name);
    return await analyzeVideoFile(file);
  } else if (isImageFile(file)) {
    console.log('📷 Analyzing image file:', file.name);
    const sizeMB = file.size / 1024 / 1024;
    
    // Photo analysis logic (from PhotoUpload component)
    const isCamera = (
      sizeMB > 3 || // Camera photos are usually >3MB
      file.name.toLowerCase().includes('img_') || // iOS camera naming
      file.name.toLowerCase().includes('dsc') || // Camera naming
      (file.type === 'image/jpeg' && sizeMB > 1.5) // Large JPEG likely camera
    );
    
    const isScreenshot = (
      file.name.toLowerCase().includes('screenshot') ||
      file.name.toLowerCase().includes('screen') ||
      file.type === 'image/png' ||
      sizeMB < 2
    );
    
    const needsCompression = isCamera && sizeMB > 8;
    
    return {
      isCamera,
      isScreenshot,
      needsCompression,
      originalSize: file.size,
      estimatedCompressedSize: needsCompression ? file.size * 0.3 : file.size,
      mediaType: 'photo'
    };
  } else {
    // Unknown file type
    return {
      isCamera: false,
      isScreenshot: false,
      needsCompression: false,
      originalSize: file.size,
      mediaType: 'photo' // Default to photo for compatibility
    };
  }
};

// Compress image (from PhotoUpload component)
const compressImage = async (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      // More aggressive compression for camera photos
      const maxWidth = 1280;
      const maxHeight = 720;
      let { width, height } = img;
      
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw and compress aggressively for camera photos
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            console.log(`📷 Camera photo compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        },
        'image/jpeg',
        0.6 // More aggressive 60% quality for camera photos
      );
    };
    
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
};

// Unified upload function that handles both photos and videos.
//
// Uploads now go straight to R2 from the browser (finding ZIP-10). The previous
// path wrote to Firebase Storage and then asked a Netlify function to copy the
// file to R2, which pulled the whole thing into memory — so anything near a
// gigabyte never made it, and those files stayed on the expensive origin while
// being stored and billed twice.
//
// The plan limit is still checked here for a fast, friendly failure, but it is
// enforced server-side in upload-init.js. This check is a courtesy, not a
// control.
export const uploadMedia = async (
  file: File,
  eventId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const startTime = Date.now();
  const video = isVideoFile(file);

  console.log('📤 Starting media upload:', {
    fileName: file.name,
    size: (file.size / 1024 / 1024).toFixed(2) + 'MB',
    type: file.type,
    mediaType: video ? 'video' : 'photo'
  });

  if (!video && !isImageFile(file)) {
    throw new Error('Unsupported file type. Please select a photo or video file.');
  }

  if (video) {
    const validation = validateVideoFile(file);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid video file');
    }
  }

  let fileToUpload = file;

  // Compress large camera photos before upload. Videos are left alone: browser
  // re-encoding is slow, lossy, and frequently worse than the original.
  if (!video) {
    const analysis = await analyzeMediaFile(file);
    if (analysis.isCamera && file.size > 8 * 1024 * 1024) {
      console.log('🗜️ Compressing camera photo...');
      onProgress?.(2);
      fileToUpload = await compressImage(file);
    }
  }

  try {
    const result = await uploadMediaToR2(fileToUpload, eventId, onProgress);

    // photoCount is incremented server-side in upload-complete, so there is no
    // separate incrementPhotoCount call here any more. It used to run as a
    // second client write that could fail independently, leaving the count and
    // the gallery disagreeing.
    console.log(`✅ Upload completed in ${Date.now() - startTime}ms:`, result.photoId);
    return result.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Media upload failed after ${Date.now() - startTime}ms:`, {
      fileName: file.name,
      sizeMB: (file.size / 1024 / 1024).toFixed(2),
      error: message
    });
    throw error;
  }
};

// Validate media file before upload
export const validateMediaFile = (file: File): { isValid: boolean; error?: string } => {
  // Check if it's a supported media type
  if (!isVideoFile(file) && !isImageFile(file)) {
    return { 
      isValid: false, 
      error: 'Unsupported file type. Please select a photo (JPG, PNG, HEIC) or video (MP4, MOV, WebM) file.' 
    };
  }

  // Video-specific validation
  if (isVideoFile(file)) {
    return validateVideoFile(file);
  }

  // Image-specific validation (basic)
  const maxSizeMB = 50; // 50MB limit for images
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > maxSizeMB) {
    return { 
      isValid: false, 
      error: `Image file too large (${fileSizeMB.toFixed(1)}MB). Maximum size is ${maxSizeMB}MB.` 
    };
  }

  // Check for very small files that might be corrupted
  if (file.size < 1024) { // Less than 1KB
    return { isValid: false, error: 'File appears to be corrupted or too small' };
  }

  return { isValid: true };
};

// Get file type for display
export const getMediaFileType = (file: File): 'photo' | 'video' | 'unknown' => {
  if (isVideoFile(file)) return 'video';
  if (isImageFile(file)) return 'photo';
  return 'unknown';
};

// Format file size for display
export const formatFileSize = (bytes: number): string => {
  const sizeMB = bytes / (1024 * 1024);
  if (sizeMB < 1) {
    const sizeKB = bytes / 1024;
    return `${sizeKB.toFixed(1)}KB`;
  }
  return `${sizeMB.toFixed(1)}MB`;
};
