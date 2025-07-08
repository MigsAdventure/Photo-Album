import { 
  collection, 
  addDoc,
  onSnapshot, 
  query, 
  where,
  doc,
  getDoc,
  getDocs 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Photo, Event } from '../types';

export const uploadPhoto = async (
  file: File, 
  eventId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  // Check if we're in development (localhost)
  const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  if (isDevelopment) {
    // Development fallback: Use Firebase Storage directly
    console.log('Development mode: Using Firebase Storage for upload');
    
    const { ref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('../firebase');
    const { v4: uuidv4 } = await import('uuid');
    
    const photoId = uuidv4();
    const storageRef = ref(storage, `events/${eventId}/photos/${photoId}`);
    
    const uploadTask = uploadBytesResumable(storageRef, file);
    
    return new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress?.(progress);
        },
        (error) => {
          console.error('Upload error:', error);
          reject(error);
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            
            // Save photo metadata to Firestore
            await addDoc(collection(db, 'photos'), {
              id: photoId,
              url: downloadURL,
              uploadedAt: new Date(),
              eventId,
              fileName: file.name,
              size: file.size
            });
            
            console.log('Development upload completed:', file.name);
            resolve(downloadURL);
          } catch (error) {
            reject(error);
          }
        }
      );
    });
    
  } else {
    // Production: Use R2 API endpoint
    console.log('Production mode: Using R2 API for upload');
    
    // Enhanced mobile debugging
    const userAgent = navigator.userAgent;
    const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
    const isAndroid = /Android/i.test(userAgent);
    
    console.log('=== FRONTEND UPLOAD DEBUG ===');
    console.log('User-Agent:', userAgent);
    console.log('Is Mobile:', isMobile);
    console.log('Is iOS:', isIOS);
    console.log('Is Android:', isAndroid);
    console.log('File details:', {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified
    });
    
    if (isMobile) {
      console.log('🔍 MOBILE UPLOAD DETECTED - Enhanced debugging enabled');
    }
    
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('eventId', eventId);
    
    console.log('FormData created with photo and eventId');

    try {
      console.log('Making fetch request to /.netlify/functions/upload');
      onProgress?.(10);
      
      // Mobile-specific upload with enhanced error handling
      let response: Response;
      
      if (isMobile) {
        console.log('🔄 Using mobile-optimized upload strategy');
        
        // For mobile: Use XMLHttpRequest instead of fetch for better compatibility
        response = await new Promise<Response>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          
          // Set timeout - increased for large camera photos
          xhr.timeout = 15000; // 15 seconds for mobile uploads
          
          xhr.onload = () => {
            console.log(`📱 XHR upload completed with status: ${xhr.status}`);
            
            // Parse response headers
            const headers = new Headers();
            xhr.getAllResponseHeaders().split('\r\n').forEach(line => {
              const parts = line.split(': ');
              if (parts.length === 2) {
                headers.set(parts[0], parts[1]);
              }
            });
            
            const response = new Response(xhr.responseText, {
              status: xhr.status,
              statusText: xhr.statusText,
              headers: headers
            });
            resolve(response);
          };
          
          xhr.onerror = (error) => {
            console.error('❌ XHR network error:', error);
            reject(new Error('Network error during mobile upload - check your connection'));
          };
          
          xhr.ontimeout = () => {
            console.error('❌ XHR timeout after 30 seconds');
            reject(new Error('Mobile upload timed out - the image may be too large or connection too slow'));
          };
          
          xhr.onabort = () => {
            console.error('❌ XHR upload aborted');
            reject(new Error('Mobile upload was cancelled'));
          };
          
          xhr.onloadstart = () => {
            console.log('📱 Mobile upload started');
            onProgress?.(5);
          };
          
          // Enhanced progress tracking for mobile
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const uploadProgress = (event.loaded / event.total) * 85; // Reserve 15% for backend processing
              console.log(`📊 Upload progress: ${Math.round(uploadProgress)}%`);
              onProgress?.(uploadProgress);
            }
          };
          
          xhr.upload.onload = () => {
            console.log('📤 Upload data sent, waiting for server response...');
            onProgress?.(90); // Upload sent, backend processing
          };
          
          xhr.upload.onerror = (error) => {
            console.error('❌ Upload error:', error);
            reject(new Error('Upload failed - please try a smaller image'));
          };
          
          xhr.open('POST', '/.netlify/functions/upload');
          
          // Mobile-specific headers for backend tracking
          xhr.setRequestHeader('X-Mobile-Request', 'true');
          xhr.setRequestHeader('X-Device-Type', isIOS ? 'iOS' : isAndroid ? 'Android' : 'Mobile');
          
          console.log('🚀 Starting XHR mobile upload...');
          xhr.send(formData);
        });
        
    } else {
      // Desktop: Use fetch as before
      console.log('🖥️ Using desktop fetch strategy');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10000); // 10 seconds for desktop

      response = await fetch('/.netlify/functions/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: {
          'X-Device-Type': 'Desktop'
        }
      });

      clearTimeout(timeoutId);
    }

      console.log('📥 Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        requestId: response.headers.get('X-Request-ID') || 'unknown',
        contentLength: response.headers.get('Content-Length')
      });

      onProgress?.(95);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response not ok. Raw error text:', errorText);
        
        let errorMessage = `Upload failed with status ${response.status}`;
        let requestId = 'unknown';
        
        try {
          const errorData = JSON.parse(errorText);
          console.error('❌ Parsed error data:', errorData);
          errorMessage = errorData.error || errorMessage;
          requestId = errorData.requestId || requestId;
          
          // Provide specific error messages for mobile users
          if (isMobile) {
            if (errorData.error?.includes('timeout')) {
              errorMessage = 'Upload timed out. Try using a smaller image or better connection.';
            } else if (errorData.error?.includes('parsing')) {
              errorMessage = 'Image format issue. Try taking a new photo or using JPEG format.';
            } else if (errorData.error?.includes('size')) {
              errorMessage = 'Image too large. Try reducing image quality in camera settings.';
            }
          }
          
        } catch (parseError) {
          console.error('❌ Failed to parse error response as JSON:', parseError);
        }
        
        const enhancedError = new Error(errorMessage);
        (enhancedError as any).requestId = requestId;
        throw enhancedError;
      }

      const resultText = await response.text();
      console.log('✅ Raw response text:', resultText.substring(0, 200) + (resultText.length > 200 ? '...' : ''));
      
      let result;
      try {
        result = JSON.parse(resultText);
        console.log('✅ Parsed response:', {
          success: result.success,
          photoId: result.photoId,
          fileName: result.fileName,
          size: result.size,
          requestId: result.requestId
        });
      } catch (parseError) {
        console.error('❌ Failed to parse successful response as JSON:', parseError);
        throw new Error('Server returned invalid response format');
      }
      
      onProgress?.(100);
      console.log('🎉 Production upload completed successfully:', result.fileName);
      
      if (isMobile) {
        console.log('📱✅ MOBILE UPLOAD SUCCESS! Request ID:', result.requestId);
      }
      
      return result.url;

    } catch (error: any) {
      const errorDetails = {
        message: error?.message || 'Unknown error',
        requestId: error?.requestId || 'unknown',
        isMobile,
        userAgent: userAgent.substring(0, 100),
        fileSize: file.size,
        fileType: file.type,
        fileName: file.name
      };
      
      console.error('❌ Upload error details:', errorDetails);
      
      if (isMobile) {
        console.error('📱❌ MOBILE UPLOAD FAILED - Request ID:', errorDetails.requestId);
      }
      
      // Enhance error message for mobile users
      if (isMobile && error.message) {
        if (error.message.includes('timeout')) {
          error.message = 'Upload timed out. This often happens with large photos on mobile. Try reducing image quality in your camera settings.';
        } else if (error.message.includes('Network error')) {
          error.message = 'Network connection issue. Check your WiFi/cellular connection and try again.';
        } else if (error.message.includes('too large')) {
          error.message = 'Photo is too large. Try using lower resolution in camera settings or compress the image.';
        }
      }
      
      throw error;
    }
  }
};

export const subscribeToPhotos = (
  eventId: string,
  callback: (photos: Photo[]) => void
) => {
  const q = query(
    collection(db, 'photos'),
    where('eventId', '==', eventId)
  );
  
  return onSnapshot(q, (snapshot) => {
    const photos: Photo[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      photos.push({
        id: doc.id,
        url: data.url,
        uploadedAt: data.uploadedAt.toDate(),
        eventId: data.eventId,
        fileName: data.fileName,
        size: data.size
      });
    });
    
    // Sort in JavaScript instead of Firestore to avoid index requirement
    photos.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    
    callback(photos);
  });
};

export const createEvent = async (title: string, date: string): Promise<string> => {
  const docRef = await addDoc(collection(db, 'events'), {
    title,
    date,
    createdAt: new Date(),
    isActive: true
  });
  return docRef.id;
};

export const getEvent = async (eventId: string): Promise<Event | null> => {
  const docRef = doc(db, 'events', eventId);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      title: data.title,
      date: data.date,
      createdAt: data.createdAt.toDate(),
      isActive: data.isActive
    };
  }
  
  return null;
};

// Professional single photo download using API
export const downloadPhoto = async (photoId: string): Promise<void> => {
  try {
    console.log('Starting download for photo:', photoId);
    
    // Check if we're in development (localhost)
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    if (isDevelopment) {
      // Development fallback: Get photo data and open in new tab
      console.log('Development mode: Using fallback download method');
      const docRef = doc(db, 'photos', photoId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const photoData = docSnap.data();
        const newWindow = window.open(photoData.url, '_blank');
        if (newWindow) {
          newWindow.focus();
          console.log('Photo opened in new tab for development testing');
        } else {
          console.error('Failed to open new tab. Please check popup blocker settings.');
        }
      } else {
        throw new Error('Photo not found');
      }
    } else {
      // Production: Use professional API download
      console.log('Production mode: Using professional download');
      const link = document.createElement('a');
      link.href = `/.netlify/functions/download/${photoId}`;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log('Professional download initiated for photo:', photoId);
    }
    
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
};

// Professional bulk download using API (creates ZIP file)
export const downloadAllPhotos = async (
  eventId: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> => {
  try {
    console.log('Starting bulk download for event:', eventId);
    
    // Check if we're in development (localhost)
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    if (isDevelopment) {
      // Development fallback: Open photos individually in new tabs
      console.log('Development mode: Opening photos individually for testing');
      
      // Get all photos for this event
      const q = query(
        collection(db, 'photos'),
        where('eventId', '==', eventId)
      );
      
      const snapshot = await getDocs(q);
      const photos: any[] = [];
      snapshot.forEach((docSnapshot) => {
        photos.push(docSnapshot.data());
      });
      
      if (photos.length === 0) {
        throw new Error('No photos found for this event');
      }
      
      console.log(`Opening ${photos.length} photos in new tabs for development`);
      
      // Open each photo in a new tab with delay
      for (let i = 0; i < photos.length; i++) {
        setTimeout(() => {
          window.open(photos[i].url, '_blank');
          onProgress?.(i + 1, photos.length);
        }, i * 300); // 300ms delay between each tab
      }
      
    } else {
      // Production: Use professional ZIP download
      console.log('Production mode: Using professional ZIP download');
      
      onProgress?.(0, 1);
      
      const link = document.createElement('a');
      link.href = `/.netlify/functions/bulk/${eventId}`;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      onProgress?.(1, 1);
      console.log('Professional ZIP download initiated for event:', eventId);
    }
    
  } catch (error) {
    console.error('Bulk download failed:', error);
    throw error;
  }
};
