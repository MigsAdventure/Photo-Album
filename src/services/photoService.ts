import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
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
import { Photo, Wedding } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const uploadPhoto = async (
  file: File, 
  weddingId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const photoId = uuidv4();
  const storageRef = ref(storage, `weddings/${weddingId}/photos/${photoId}`);
  
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
            weddingId,
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
  weddingId: string,
  callback: (photos: Photo[]) => void
) => {
  const q = query(
    collection(db, 'photos'),
    where('weddingId', '==', weddingId),
    orderBy('uploadedAt', 'desc')
  );
  
  return onSnapshot(q, (snapshot) => {
    const photos: Photo[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      photos.push({
        id: doc.id,
        url: data.url,
        uploadedAt: data.uploadedAt.toDate(),
        weddingId: data.weddingId,
        fileName: data.fileName,
        size: data.size
      });
    });
    callback(photos);
  });
};

export const createWedding = async (title: string, date: string): Promise<string> => {
  const docRef = await addDoc(collection(db, 'weddings'), {
    title,
    date,
    createdAt: new Date(),
    isActive: true
  });
  return docRef.id;
};

export const getWedding = async (weddingId: string): Promise<Wedding | null> => {
  const docRef = doc(db, 'weddings', weddingId);
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
