import { 
  collection, 
  addDoc,
  onSnapshot, 
  query, 
  where,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  increment,
  deleteDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Photo, Event } from '../types';
import { getCurrentSessionId, addOwnedPhoto, removeOwnedPhoto, getPhotoOwnership } from './sessionService';

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
  
  // Get current session ID for ownership tracking
  const sessionId = getCurrentSessionId();
  
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
          
          // Save photo metadata to Firestore with ownership tracking
          const docRef = await addDoc(collection(db, 'photos'), {
            id: photoId,
            url: downloadURL,
            uploadedAt: new Date(),
            eventId,
            fileName: file.name,
            size: file.size,
            contentType: file.type,
            storagePath: `events/${eventId}/photos/${photoId}.${extension}`,
            mediaType: 'photo' as const,
            uploadedBy: sessionId // Track ownership
          });
          
          // Add to user's owned photos list
          addOwnedPhoto(docRef.id);
          
          console.log('✅ Firebase upload completed with ownership:', file.name, 'by session:', sessionId);
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
        size: data.size,
        mediaType: data.mediaType || 'photo' as const, // Default to 'photo' for backward compatibility
        uploadedBy: data.uploadedBy // Include ownership info
      });
    });
    
    // Sort in JavaScript instead of Firestore to avoid index requirement
    photos.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    
    callback(photos);
  });
};

export const createEvent = async (title: string, date: string, organizerEmail: string): Promise<string> => {
  // Generate custom event ID using event date, title, and random hash
  const customEventId = generateEventId(title, date);
  
  console.log('📅 Creating event with custom ID:', customEventId);
  console.log('🎯 Event details:', { title, date, organizerEmail });
  
  // Use setDoc with custom ID instead of addDoc with auto-generated ID
  const docRef = doc(db, 'events', customEventId);
  await setDoc(docRef, {
    title,
    date,
    createdAt: new Date(),
    isActive: true,
    organizerEmail,
    planType: 'free',
    photoLimit: 2,
    photoCount: 0
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
      isActive: data.isActive,
      organizerEmail: data.organizerEmail || '',
      planType: data.planType || 'free',
      photoLimit: data.planType === 'free' ? 2 : (data.photoLimit || 2), // Force 2-photo limit for all free events
      photoCount: data.photoCount || 0,
      paymentId: data.paymentId,
      customBranding: data.customBranding
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

// Professional bulk download with email delivery - enhanced with background processing
export const requestEmailDownload = async (
  eventId: string,
  email: string
): Promise<{
  success: boolean;
  processing: 'immediate' | 'background';
  message: string;
  fileCount?: number;
  estimatedSizeMB?: number;
  videoCount?: number;
  estimatedWaitTime?: string;
  requestId: string;
}> => {
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
      // Try to parse error response - read as text first to avoid "body stream already read" error
      let errorMessage = 'Failed to request email download';
      try {
        const responseText = await response.text();
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.details || errorMessage;
        } catch (parseError) {
          // If JSON parsing fails, it might be an HTML error page
          if (responseText.includes('DOCTYPE')) {
            errorMessage = 'Server error: The download service is temporarily unavailable. Please try again in a few moments.';
          } else {
            errorMessage = `Server error (${response.status}): ${response.statusText}`;
          }
        }
      } catch (textError) {
        // If we can't even read the response as text
        errorMessage = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('✅ Email download requested successfully:', result);
    
    // Log different processing types
    if (result.processing === 'background') {
      console.log(`🚀 Background processing initiated:`, {
        fileCount: result.fileCount,
        sizeMB: result.estimatedSizeMB,
        videoCount: result.videoCount,
        waitTime: result.estimatedWaitTime
      });
    } else {
      console.log(`⚡ Immediate processing completed:`, {
        fileCount: result.photoCount || result.fileCount,
        sizeMB: result.fileSizeMB
      });
    }
    
    return result;
    
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

// Freemium & Premium functions

// Increment photo count for an event
export const incrementPhotoCount = async (eventId: string): Promise<void> => {
  const eventRef = doc(db, 'events', eventId);
  await updateDoc(eventRef, {
    photoCount: increment(1)
  });
};

// Check if event can accept more photos (freemium limit)
export const canUploadPhoto = async (eventId: string): Promise<boolean> => {
  const event = await getEvent(eventId);
  if (!event) return false;
  
  if (event.planType === 'premium') return true;
  
  return event.photoCount < event.photoLimit;
};

// Upgrade event to premium
export const upgradeEventToPremium = async (
  eventId: string, 
  paymentId: string,
  customBranding?: any
): Promise<void> => {
  const eventRef = doc(db, 'events', eventId);
  await updateDoc(eventRef, {
    planType: 'premium',
    paymentId,
    photoLimit: -1, // Unlimited
    customBranding: customBranding || null
  });
  
  console.log('✅ Event upgraded to premium:', eventId);
};

// Photo deletion functions with ownership checking

// Check if current user can delete a photo
export const canDeletePhoto = async (photoId: string): Promise<boolean> => {
  try {
    // Get photo metadata from Firestore
    const docRef = doc(db, 'photos', photoId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      console.warn('⚠️ Photo not found for deletion check:', photoId);
      return false;
    }
    
    const photoData = docSnap.data();
    const uploaderSessionId = photoData.uploadedBy;
    
    // Check ownership using session service
    const ownership = getPhotoOwnership(photoId, uploaderSessionId);
    
    console.log('🔍 Delete permission check for', photoId, ':', ownership.canDelete ? 'ALLOWED' : 'DENIED');
    return ownership.canDelete;
    
  } catch (error) {
    console.error('❌ Error checking delete permission:', error);
    return false;
  }
};

// Delete a photo (with ownership validation)
export const deletePhoto = async (photoId: string): Promise<void> => {
  try {
    console.log('🗑️ Initiating photo deletion:', photoId);
    
    // First verify ownership
    const canDelete = await canDeletePhoto(photoId);
    if (!canDelete) {
      throw new Error('You can only delete photos that you uploaded');
    }
    
    // Get photo metadata to find storage path
    const docRef = doc(db, 'photos', photoId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      throw new Error('Photo not found');
    }
    
    const photoData = docSnap.data();
    const storagePath = photoData.storagePath;
    const eventId = photoData.eventId;
    
    console.log('📁 Deleting from storage path:', storagePath);
    
    // Delete from Firebase Storage
    if (storagePath) {
      try {
        const { ref, deleteObject } = await import('firebase/storage');
        const { storage } = await import('../firebase');
        
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
        console.log('✅ Photo deleted from Firebase Storage');
      } catch (storageError) {
        console.warn('⚠️ Failed to delete from storage (may not exist):', storageError);
        // Continue with Firestore deletion even if storage deletion fails
      }
    }
    
    // Delete from Firestore
    await deleteDoc(docRef);
    console.log('✅ Photo metadata deleted from Firestore');
    
    // Remove from user's owned photos list
    removeOwnedPhoto(photoId);
    
    // Decrement photo count for the event
    try {
      const eventRef = doc(db, 'events', eventId);
      await updateDoc(eventRef, {
        photoCount: increment(-1)
      });
      console.log('✅ Event photo count decremented');
    } catch (error) {
      console.warn('⚠️ Failed to decrement event photo count:', error);
      // Don't fail the entire deletion for this
    }
    
    console.log('🎉 Photo deletion completed successfully:', photoId);
    
  } catch (error) {
    console.error('❌ Photo deletion failed:', error);
    throw error;
  }
};

// Get photo ownership info (for UI display)
export const getPhotoOwnershipInfo = (photoId: string, uploaderSessionId?: string) => {
  return getPhotoOwnership(photoId, uploaderSessionId);
};
