import { 
  collection, 
  addDoc,
  onSnapshot, 
  query, 
  where,
  doc,
  getDoc 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Photo, Event } from '../types';

export const uploadPhoto = async (
  file: File, 
  eventId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const formData = new FormData();
  formData.append('photo', file);
  formData.append('eventId', eventId);

  try {
    // Upload to our API endpoint which handles R2 upload
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Upload failed');
    }

    const result = await response.json();
    
    // Report 100% progress since API upload is complete
    onProgress?.(100);
    
    console.log('Photo uploaded successfully:', result.fileName);
    return result.url;

  } catch (error) {
    console.error('Upload error:', error);
    throw error;
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
    console.log('Starting professional download for photo:', photoId);
    
    // Create download link that points to our API
    const link = document.createElement('a');
    link.href = `/api/download/${photoId}`;
    link.style.display = 'none';
    
    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('Professional download initiated for photo:', photoId);
    
  } catch (error) {
    console.error('Professional download failed:', error);
    throw error;
  }
};

// Professional bulk download using API (creates ZIP file)
export const downloadAllPhotos = async (
  eventId: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> => {
  try {
    console.log('Starting professional bulk download for event:', eventId);
    
    // Report progress start
    onProgress?.(0, 1);
    
    // Create download link that points to our bulk API
    const link = document.createElement('a');
    link.href = `/api/bulk/${eventId}`;
    link.style.display = 'none';
    
    // Trigger ZIP download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Report progress complete
    onProgress?.(1, 1);
    
    console.log('Professional bulk download initiated for event:', eventId);
    
  } catch (error) {
    console.error('Professional bulk download failed:', error);
    throw error;
  }
};
