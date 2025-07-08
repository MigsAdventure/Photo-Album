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
    
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('eventId', eventId);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      
      onProgress?.(100);
      console.log('Production upload completed:', result.fileName);
      return result.url;

    } catch (error) {
      console.error('Upload error:', error);
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
      link.href = `/api/download/${photoId}`;
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
      link.href = `/api/bulk/${eventId}`;
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
