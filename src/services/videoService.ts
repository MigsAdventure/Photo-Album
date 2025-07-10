import { VideoProcessingOptions, FileAnalysis } from '../types';

// Default video processing configuration
export const DEFAULT_VIDEO_CONFIG: VideoProcessingOptions = {
  maxDuration: 600, // 10 minutes
  maxWidth: 1280,
  maxHeight: 720,
  quality: 0.7,
  format: 'mp4'
};

// Video file validation
export const validateVideoFile = (file: File): { isValid: boolean; error?: string; duration?: number } => {
  // Supported formats - MP4 files can have various MIME types
  const supportedFormats = [
    'video/mp4',
    'video/mpeg',        // Common for MP4 files - like your "MPEG-4 movie" 
    'video/quicktime',   // MOV files
    'video/webm',
    'video/x-msvideo',   // AVI files
    'application/mp4',   // Alternative MP4 MIME type
    'video/3gpp',
    'video/x-ms-wmv'
  ];
  
  // Check MIME type first, then fallback to file extension
  const hasValidMimeType = supportedFormats.includes(file.type);
  const hasValidExtension = file.name.toLowerCase().match(/\.(mp4|mov|webm|avi|3gp|wmv)$/);
  
  // If neither MIME type nor extension is valid, reject
  if (!hasValidMimeType && !hasValidExtension) {
    console.log('❌ Invalid video file:', { type: file.type, name: file.name });
    return { isValid: false, error: `Unsupported video format (${file.type}). Please use MP4, WebM, MOV, or AVI` };
  }
  
  console.log('✅ Valid video file detected:', { type: file.type, name: file.name, hasValidMimeType, hasValidExtension });

  // Check file size (1GB limit)
  const maxSizeMB = 1024;
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > maxSizeMB) {
    return { isValid: false, error: `Video file too large. Maximum size is ${maxSizeMB}MB` };
  }

  return { isValid: true };
};

// Get video duration and dimensions
export const getVideoMetadata = (file: File): Promise<{ duration: number; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    
    video.onloadedmetadata = () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight
      };
      
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };
    
    video.src = url;
  });
};

// Generate video thumbnail
export const generateVideoThumbnail = (file: File, timeSeconds: number = 1): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const url = URL.createObjectURL(file);
    
    video.onloadedmetadata = () => {
      canvas.width = Math.min(video.videoWidth, 320);
      canvas.height = Math.min(video.videoHeight, 240);
      
      video.currentTime = Math.min(timeSeconds, video.duration * 0.1);
    };
    
    video.onseeked = () => {
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(url);
        resolve(thumbnailDataUrl);
      } else {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to create canvas context'));
      }
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    };
    
    video.src = url;
    video.muted = true; // Required for autoplay in some browsers
  });
};

// Compress video if needed (using MediaRecorder API)
export const compressVideo = (file: File, options: Partial<VideoProcessingOptions> = {}): Promise<File> => {
  // const config = { ...DEFAULT_VIDEO_CONFIG, ...options };
  
  return new Promise((resolve, reject) => {
    // For now, return original file since video compression is complex
    // In a production environment, you might want to use FFmpeg.wasm or similar
    console.log('Video compression requested but not implemented - returning original file');
    console.log('Original file size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
    
    // Basic validation that video meets size requirements
    const maxSizeMB = 200; // Compression threshold for large uploads
    const fileSizeMB = file.size / (1024 * 1024);
    
    if (fileSizeMB > maxSizeMB) {
      reject(new Error(`Video file too large: ${fileSizeMB.toFixed(1)}MB. Maximum size is ${maxSizeMB}MB`));
      return;
    }
    
    resolve(file);
  });
};

// Enhanced file analysis for videos
export const analyzeVideoFile = async (file: File): Promise<FileAnalysis> => {
  const validation = validateVideoFile(file);
  
  if (!validation.isValid) {
    return {
      isCamera: false,
      isScreenshot: false,
      needsCompression: false,
      originalSize: file.size,
      mediaType: 'video',
      isValidDuration: false
    };
  }
  
  try {
    const metadata = await getVideoMetadata(file);
    const isValidDuration = metadata.duration <= DEFAULT_VIDEO_CONFIG.maxDuration;
    const needsCompression = file.size > 200 * 1024 * 1024; // 200MB threshold
    
    // Detect if it's likely a phone camera video
    const isCamera = (
      metadata.height >= 720 && // HD or better
      metadata.duration > 10 && // Longer than 10 seconds
      file.size > 10 * 1024 * 1024 // Larger than 10MB
    );
    
    return {
      isCamera,
      isScreenshot: false, // Videos are generally not screenshots
      needsCompression,
      originalSize: file.size,
      estimatedCompressedSize: needsCompression ? file.size * 0.7 : file.size,
      mediaType: 'video',
      duration: metadata.duration,
      isValidDuration
    };
  } catch (error) {
    console.error('Failed to analyze video file:', error);
    return {
      isCamera: false,
      isScreenshot: false,
      needsCompression: false,
      originalSize: file.size,
      mediaType: 'video',
      isValidDuration: false
    };
  }
};

// Format duration for display
export const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// Check if browser supports video recording
export const canRecordVideo = (): boolean => {
  try {
    return !!(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices && 
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      'MediaRecorder' in window
    );
  } catch {
    return false;
  }
};
