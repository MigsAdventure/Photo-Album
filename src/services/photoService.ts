import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Photo, Event } from '../types';
import { getUploadState, UploadState } from './planService';
import { getOwnerSecret, removeOwnedPhoto, getPhotoOwnership } from './sessionService';

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

// uploadPhoto and copyToR2ViaAPI lived here: the browser wrote to Firebase
// Storage, then asked netlify/functions/r2-copy.js to pull the whole file into
// memory and write it to R2. Anything near a gigabyte exceeded both the memory
// limit and the execution window, so large videos never reached R2 at all -
// staying on the expensive origin, being fetched from there by the archive
// worker, and being stored and billed twice (finding ZIP-10).
//
// Uploads now go straight to R2 from the browser via presigned URLs. See
// src/services/r2UploadService.ts and netlify/functions/upload-init.js.

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
        uploadedBy: data.uploadedBy, // Include ownership info
        r2Key: data.r2Key, // Include R2 key for cost-effective display
        contentType: data.contentType, // Include content type for proper R2 handling
        thumbnailUrl: data.thumbnailUrl || undefined // Small preview, absent on older photos
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
      // photoLimit is retained on the document for older events but no longer
      // drives anything. Uploads are governed by a time window now
      // (src/services/planService.ts, finding UX-1) — the old line here forced
      // every free event to 2 regardless of what the document said, which is
      // what blocked the third guest at a wedding.
      photoLimit: data.photoLimit ?? -1,
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

// Request an emailed archive of the event's media.
//
// This used to analyse the whole collection in the browser and pick a processing
// backend from the result (findings ZIP-1, ZIP-4). Three things were wrong with
// that:
//
//   1. The first branch called a Google Cloud Run URL that was decommissioned in
//      January 2025. Any collection with an 80MB+ video, over 500MB total, or
//      more than 10 videos hit it first and sat through the full 30-second
//      AbortSignal timeout before falling back. project-state.md recorded the
//      removal; the frontend never got the memo.
//   2. It posted the resulting photo array onward, so a client could nominate
//      arbitrary URLs for our processor to fetch and package into an archive we
//      then email out.
//   3. Its size thresholds disagreed with the three server-side routers behind
//      it, so identical collections took different paths depending on which
//      entry point saw them first.
//
// The browser now states what it wants and lets the server decide how. The
// server reads the collection from Firestore rather than trusting this call.
export const requestEmailDownload = async (
  eventId: string,
  email: string
): Promise<{
  success: boolean;
  processing: string;
  message: string;
  fileCount?: number;
  estimatedSizeMB?: number;
  videoCount?: number;
  estimatedWaitTime?: string;
  requestId: string;
}> => {
  console.log('📧 Requesting email download for event:', eventId);

  const response = await fetch('/.netlify/functions/email-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, email })
  });

  if (!response.ok) {
    let message = 'We could not start your download. Please try again in a moment.';

    try {
      const body = await response.json();
      // The server writes messages meant to be read by a person, including the
      // rate-limit case where the wait time matters. Prefer them over a generic
      // string, and keep the follow-up action if one was given.
      if (body?.error) {
        message = body.action ? `${body.error} ${body.action}` : body.error;
      }
    } catch {
      // A non-JSON body means something upstream returned an error page rather
      // than the function running. Don't show the customer raw HTML.
      message = 'The download service is temporarily unavailable. Please try again shortly.';
    }

    throw new Error(message);
  }

  const result = await response.json();
  console.log('✅ Download request accepted:', result.requestId);
  return result;
};

// downloadAllPhotos used to live here: it opened every photo in its own browser
// tab, 300ms apart. Nothing has called it since the email flow landed, and every
// popup blocker in existence stops it after the third tab. Removed rather than
// left as a trap for whoever finds it next.

// Freemium & Premium functions

// incrementPhotoCount was here. The count is adjusted server-side now -
// upload-complete.js increments it, delete-photo.js decrements it - and
// firestore.rules denies the client write it used to perform.
//
// Doing it as a separate client write was also a correctness bug: if the guest
// closed the tab between saving the photo and bumping the count, the event was
// permanently miscounted, and the plan limit is computed from that count.

// Can this event accept uploads right now?
//
// Delegates to the shared window logic. The server runs the same check in
// upload-init.js and is authoritative; this is so the UI can explain the state
// before a guest picks a file rather than failing afterwards.
export const canUploadPhoto = async (eventId: string): Promise<boolean> => {
  const event = await getEvent(eventId);
  if (!event) return false;

  return getUploadState(event).canUpload;
};

// The full state, for UI that needs to explain itself rather than just gate.
export const getEventUploadState = async (eventId: string): Promise<UploadState | null> => {
  const event = await getEvent(eventId);
  return event ? getUploadState(event) : null;
};

// Upgrading an event to premium is deliberately NOT available on the client.
//
// This function used to write planType, photoLimit and paymentId directly from
// the browser. Because it was an exported module function, unlocking unlimited
// uploads for any event was a single call from the developer console with no
// payment involved (finding SEC-2).
//
// Plan state is now Admin-SDK-only, enforced by firestore.rules, and is written
// exclusively by netlify/functions/ghl-webhook.js after it has verified the
// payment signature. If you need to upgrade an event manually, do it from the
// Firebase console or add an authenticated admin endpoint — do not reintroduce
// a client-side path.

// Photo deletion functions with ownership checking

// Can the current browser offer a delete affordance for this photo?
//
// This is a UI hint, answered entirely from the local owned-photos list. The
// real check happens in netlify/functions/delete-photo.js, which requires the
// session secret — so being wrong here costs nothing worse than showing or
// hiding an icon.
//
// It previously fetched the photo document from Firestore to read uploadedBy.
// The gallery calls it once per photo on every snapshot, so a 400-photo event
// issued 400 Firestore reads every time anyone uploaded anything, purely to
// decide whether to draw a delete button (finding UX-3). It is now synchronous
// and free; the async signature is kept so existing call sites don't change.
export const canDeletePhoto = async (photoId: string): Promise<boolean> => {
  return getPhotoOwnership(photoId).canDelete;
};

// Delete a photo.
//
// This used to run entirely in the browser: check localStorage, delete the
// Firestore document, attempt the Storage object, never touch R2. Two things
// were wrong with that. The ownership check was advisory — nothing stopped a
// caller skipping it — and the Storage delete was denied by the storage rules,
// so the photo disappeared from the gallery while its bytes stayed in Firebase
// Storage and R2, billed forever and unreachable by any UI (findings SEC-5,
// SEC-7).
//
// Deletion now happens server-side in one operation across all three stores.
// The browser presents its session secret; the server checks it against the
// hash recorded on the photo.
export const deletePhoto = async (photoId: string): Promise<void> => {
  console.log('🗑️ Requesting photo deletion:', photoId);

  const response = await fetch('/.netlify/functions/delete-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photoId,
      ownerSecret: getOwnerSecret()
    })
  });

  if (!response.ok) {
    let message = 'Could not delete the photo. Please try again.';
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error response; keep the generic message.
    }
    console.error('❌ Photo deletion failed:', response.status, message);
    throw new Error(message);
  }

  // Drop it from the local owned list so the UI stops offering a delete
  // affordance for something that no longer exists.
  removeOwnedPhoto(photoId);

  console.log('🎉 Photo deletion completed:', photoId);
};

// Get photo ownership info (for UI display)
export const getPhotoOwnershipInfo = (photoId: string, uploaderSessionId?: string) => {
  return getPhotoOwnership(photoId, uploaderSessionId);
};
