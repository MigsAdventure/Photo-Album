import { 
  collection, 
  addDoc,
  onSnapshot, 
  query, 
  where,
  doc,
  getDoc,
  getDocs,
  setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Photo, Event } from '../types';

// Helper function to create URL-safe slug from event title
const createSlug = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 50); // Limit length to 50 characters
};

// Helper function to generate random hash
const generateRandomHash = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Helper function to format date as YYYY-MM-DD (timezone-safe)
const formatDateForId = (dateString: string): string => {
  // Handle date string directly to avoid timezone issues
  if (dateString.includes('-')) {
    // Already in YYYY-MM-DD format, use as-is
    return dateString.split('T')[0]; // Remove time part if present
  }
  
  // Parse and format if needed
  const date = new Date(dateString + 'T00:00:00'); // Add time to avoid timezone shift
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Generate custom event ID with format: YYYY-MM-DD_event-name-slug_random-hash
const generateEventId = (title: string, date: string): string => {
  const formattedDate = formatDateForId(date);
  const slug = createSlug(title);
  const hash = generateRandomHash();
  return `${formattedDate}_${slug}_${hash}`;
};

export const uploadPhoto = async (
  file: File, 
  eventId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  // Always use Firebase Storage for reliable uploads
  console.log('🔥 Using Firebase Storage for upload (100% reliability)');
  
  const { ref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('../firebase');
  const { v4: uuidv4 } = await import('uuid');
  
  const photoId = uuidv4();
  const extension = file.name.split('.').pop() || 'jpg';
  const storageRef = ref(storage, `events/${eventId}/photos/${photoId}.${extension}`);
  
  const uploadTask = uploadBytesResumable(storageRef, file);
  
  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log(`🔥 Firebase upload progress: ${Math.round(progress)}%`);
        onProgress?.(progress);
      },
      (error) => {
        console.error('❌ Firebase upload error:', error);
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
            size: file.size,
            contentType: file.type,
            storagePath: `events/${eventId}/photos/${photoId}.${extension}`
          });
          
          console.log('✅ Firebase upload completed:', file.name);
          resolve(downloadURL);
        } catch (error) {
          console.error('❌ Firebase metadata save error:', error);
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
  // Generate custom event ID using event date, title, and random hash
  const customEventId = generateEventId(title, date);
  
  console.log('📅 Creating event with custom ID:', customEventId);
  console.log('🎯 Event details:', { title, date });
  
  // Use setDoc with custom ID instead of addDoc with auto-generated ID
  const docRef = doc(db, 'events', customEventId);
  await setDoc(docRef, {
    title,
    date,
    createdAt: new Date(),
    isActive: true
  });
  
  console.log('✅ Event created successfully with ID:', customEventId);
  return customEventId;
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

// Professional single photo download - currently basic, will be enhanced with email system
export const downloadPhoto = async (photoId: string): Promise<void> => {
  try {
    console.log('Starting download for photo:', photoId);
    
    const docRef = doc(db, 'photos', photoId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const photoData = docSnap.data();
      const newWindow = window.open(photoData.url, '_blank');
      if (newWindow) {
        newWindow.focus();
        console.log('Photo opened in new tab');
      } else {
        console.error('Failed to open new tab. Please check popup blocker settings.');
      }
    } else {
      throw new Error('Photo not found');
    }
    
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
};

// Professional bulk download with email delivery
export const requestEmailDownload = async (
  eventId: string,
  email: string
): Promise<void> => {
  try {
    console.log('📧 Requesting email download for event:', eventId, 'to:', email);
    
    const response = await fetch('/.netlify/functions/email-download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId,
        email
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to request email download');
    }

    const result = await response.json();
    console.log('✅ Email download requested successfully:', result);
    
  } catch (error) {
    console.error('❌ Email download request failed:', error);
    throw error;
  }
};

// Legacy bulk download - will be replaced with email system
export const downloadAllPhotos = async (
  eventId: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> => {
  try {
    console.log('📥 Legacy bulk download - opening photos individually');
    
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
    
    console.log(`Opening ${photos.length} photos individually`);
    
    // Open each photo in a new tab with delay
    for (let i = 0; i < photos.length; i++) {
      setTimeout(() => {
        window.open(photos[i].url, '_blank');
        onProgress?.(i + 1, photos.length);
      }, i * 300); // 300ms delay between each tab
    }
    
  } catch (error) {
    console.error('Legacy bulk download failed:', error);
    throw error;
  }
};
