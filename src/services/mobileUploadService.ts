// Mobile-optimized upload service that uses the reliable Netlify function
// This replaces the direct Firebase Storage uploads for better mobile reliability

interface UploadResponse {
  success: boolean;
  photoId: string;
  url: string;
  fileName: string;
  size: number;
  requestId: string;
  error?: string;
  details?: string;
}

// Detect if we're on a mobile device
const isMobileDevice = (): boolean => {
  return /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent);
};

// Mobile-optimized upload using Netlify function with R2 storage
export const uploadPhotoMobile = async (
  file: File,
  eventId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  console.log(`📱 MOBILE UPLOAD START [${requestId}]:`, {
    fileName: file.name,
    size: file.size,
    type: file.type,
    eventId,
    isMobile: isMobileDevice(),
    userAgent: navigator.userAgent.substring(0, 100)
  });

  // Create FormData for multipart upload
  const formData = new FormData();
  formData.append('file', file);
  formData.append('eventId', eventId);

  // Mobile-optimized fetch with longer timeout and better error handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.error(`📱❌ MOBILE UPLOAD TIMEOUT [${requestId}] after 60 seconds`);
  }, 60000); // 60 second timeout for mobile

  try {
    onProgress?.(10); // Starting upload

    // Use XMLHttpRequest for mobile instead of fetch for better progress tracking
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Enhanced progress tracking
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 90); // Reserve 10% for processing
          console.log(`📱📊 MOBILE UPLOAD PROGRESS [${requestId}]: ${progress}%`);
          onProgress?.(progress);
        }
      };

      xhr.onload = () => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        
        if (xhr.status === 200) {
          try {
            const response: UploadResponse = JSON.parse(xhr.responseText);
            console.log(`📱✅ MOBILE UPLOAD SUCCESS! [${requestId}] in ${duration}ms:`, {
              photoId: response.photoId,
              url: response.url,
              size: response.size,
              serverRequestId: response.requestId
            });
            
            onProgress?.(100);
            resolve(response.url);
          } catch (parseError) {
            console.error(`📱❌ MOBILE RESPONSE PARSE ERROR [${requestId}]:`, parseError);
            const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
            reject(new Error(`Response parsing failed: ${errorMessage}`));
          }
        } else {
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            console.error(`📱❌ MOBILE UPLOAD FAILED [${requestId}] - Status ${xhr.status}:`, errorResponse);
            reject(new Error(errorResponse.details || errorResponse.error || `Upload failed with status ${xhr.status}`));
          } catch {
            console.error(`📱❌ MOBILE UPLOAD FAILED [${requestId}] - Status ${xhr.status}: ${xhr.responseText}`);
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        console.error(`📱❌ MOBILE UPLOAD NETWORK ERROR [${requestId}] after ${duration}ms`);
        reject(new Error('Network error during upload'));
      };

      xhr.onabort = () => {
        clearTimeout(timeoutId);
        console.error(`📱❌ MOBILE UPLOAD ABORTED [${requestId}]`);
        reject(new Error('Upload was aborted'));
      };

      xhr.ontimeout = () => {
        clearTimeout(timeoutId);
        console.error(`📱❌ MOBILE UPLOAD TIMEOUT [${requestId}]`);
        reject(new Error('Upload timed out'));
      };

      // Set mobile-specific headers
      xhr.open('POST', '/.netlify/functions/upload');
      xhr.setRequestHeader('X-Mobile-Request', 'true');
      xhr.setRequestHeader('X-Device-Type', isMobileDevice() ? 'mobile' : 'desktop');
      xhr.setRequestHeader('X-Request-ID', requestId);
      
      // Start the upload
      console.log(`📱🚀 STARTING XHR UPLOAD [${requestId}] to Netlify function`);
      xhr.send(formData);
    });

  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : 'Unknown';
    
    console.error(`📱❌ MOBILE UPLOAD ERROR [${requestId}] after ${duration}ms:`, {
      error: errorMessage,
      stack: errorStack,
      fileName: file.name,
      fileSize: file.size,
      eventId,
      userAgent: navigator.userAgent.substring(0, 100)
    });
    
    // Provide more specific error messages for mobile users
    if (errorName === 'AbortError') {
      throw new Error('Upload timed out. Please check your connection and try again.');
    } else if (errorMessage.includes('Network')) {
      throw new Error('Network error. Please check your internet connection and try again.');
    } else if (errorMessage.includes('timeout')) {
      throw new Error('Upload took too long. Please try with a smaller image or better connection.');
    } else {
      throw new Error(`Upload failed: ${errorMessage}`);
    }
  }
};

// Fallback to regular upload service for desktop or when mobile upload fails
export const uploadPhotoWithFallback = async (
  file: File,
  eventId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const isMobile = isMobileDevice();
  
  if (isMobile) {
    try {
      console.log('📱 Attempting mobile-optimized upload');
      return await uploadPhotoMobile(file, eventId, onProgress);
    } catch (mobileError) {
      const errorMessage = mobileError instanceof Error ? mobileError.message : 'Unknown error';
      console.warn('📱⚠️ Mobile upload failed, falling back to Firebase:', errorMessage);
      
      // Import the original Firebase upload as fallback
      const { uploadPhoto } = await import('./photoService');
      console.log('🔥 Falling back to Firebase Storage upload');
      return await uploadPhoto(file, eventId, onProgress);
    }
  } else {
    console.log('💻 Desktop detected, using standard upload');
    // Import the original Firebase upload for desktop
    const { uploadPhoto } = await import('./photoService');
    return await uploadPhoto(file, eventId, onProgress);
  }
};

// Helper function to check if the Netlify function is available
export const checkNetlifyFunctionAvailability = async (): Promise<boolean> => {
  try {
    const response = await fetch('/.netlify/functions/upload', {
      method: 'OPTIONS',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.ok;
  } catch {
    return false;
  }
};

// Validate file before upload (mobile-specific checks)
export const validateMobileUpload = (file: File): { isValid: boolean; error?: string } => {
  // Check file type
  if (!file.type.startsWith('image/')) {
    return { isValid: false, error: 'Only image files are supported' };
  }

  // Check file size (50MB limit for mobile)
  const maxSizeMB = 50;
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > maxSizeMB) {
    return { 
      isValid: false, 
      error: `File too large (${fileSizeMB.toFixed(1)}MB). Maximum size is ${maxSizeMB}MB.` 
    };
  }

  // Check for very small files that might be corrupted
  if (file.size < 1024) { // Less than 1KB
    return { isValid: false, error: 'File appears to be corrupted or too small' };
  }

  return { isValid: true };
};

// Get upload progress text for mobile users
export const getMobileUploadStatusText = (progress: number, fileName: string): string => {
  if (progress < 10) {
    return 'Preparing upload...';
  } else if (progress < 90) {
    return `Uploading ${fileName}... ${progress}%`;
  } else if (progress < 100) {
    return 'Processing image...';
  } else {
    return 'Upload complete!';
  }
};
