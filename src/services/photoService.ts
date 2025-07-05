import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where,
  doc,
  getDoc 
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL,
  UploadTaskSnapshot 
} from 'firebase/storage';
import { db, storage } from '../firebase';
import { Photo, Event } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const uploadPhoto = async (
  file: File, 
  eventId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const photoId = uuidv4();
  const storageRef = ref(storage, `events/${eventId}/photos/${photoId}`);
  
  const uploadTask = uploadBytesResumable(storageRef, file);
  
  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot: UploadTaskSnapshot) => {
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
          
          resolve(downloadURL);
        } catch (error) {
          reject(error);
        }
      }
    );
  });
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

export const downloadAllPhotos = async (
  photos: Photo[],
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> => {
  if (photos.length === 0) {
    throw new Error('No photos to download');
  }

  console.log(`Opening ${photos.length} photos in new tabs for download...`);
  console.log('Due to Firebase Storage CORS limitations, photos will open in new tabs.');
  console.log('Right-click on each image and select "Save image as..." to download.');

  // Open all photos in new tabs with a slight delay between each
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    
    setTimeout(() => {
      console.log(`Opening photo ${i + 1}/${photos.length}:`, photo.fileName);
      window.open(photo.url, '_blank');
      
      // Report progress
      onProgress?.(i + 1, photos.length);
    }, i * 300); // 300ms delay between each tab opening
  }

  console.log('All photos will be opened in new tabs. Right-click each image to save.');
};
