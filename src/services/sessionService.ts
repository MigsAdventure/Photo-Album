import { UserSession, PhotoOwnership } from '../types';

const SESSION_STORAGE_KEY = 'wedding-app-session';

// Generate a unique session ID.
//
// This value is a bearer secret: presenting it to the delete-photo function is
// what proves you uploaded a photo (see netlify/functions/delete-photo.js). It
// must therefore be unguessable.
//
// The previous implementation was `sess_${Date.now()}_${Math.random()...}`,
// which carried roughly 46 bits of entropy on top of a timestamp an attacker
// can narrow to the minute. crypto.randomUUID gives 122 bits from a CSPRNG.
// Math.random is not a CSPRNG and must not be used for this.
const generateSessionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sess_${crypto.randomUUID()}`;
  }

  // Fallback for older browsers that have getRandomValues but not randomUUID.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `sess_${hex}`;
  }

  console.warn('⚠️ No secure random source available; photo ownership will be weak');
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

// Derive the public ownership token from the session secret.
//
// The photo document stores this hash rather than the session id itself. Every
// guest can read every photo document through the gallery subscription, so
// storing the raw id would hand each of them the credential needed to delete
// other people's photos — which is exactly the hole finding SEC-5 describes.
// A hash is safe to publish; the secret behind it never leaves this browser
// except when calling delete-photo.
export const getOwnerToken = async (): Promise<string> => {
  const sessionId = getCurrentSessionId();

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // Without SubtleCrypto we cannot hash, so fall back to the legacy scheme.
    // delete-photo accepts both. SubtleCrypto requires a secure context, so in
    // practice this only happens on plain http during local development.
    console.warn('⚠️ SubtleCrypto unavailable; falling back to legacy ownership token');
    return sessionId;
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sessionId)
  );

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// The raw secret, sent only to the delete-photo function. Never store this in
// Firestore and never render it into the page.
export const getOwnerSecret = (): string => getCurrentSessionId();

// Get or create user session
export const getOrCreateSession = (): UserSession => {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      const session = JSON.parse(stored) as UserSession;
      
      // Validate session structure
      if (session.sessionId && Array.isArray(session.ownedPhotos)) {
        console.log('📱 Retrieved existing session:', session.sessionId, 'with', session.ownedPhotos.length, 'owned photos');
        return session;
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to parse existing session, creating new one:', error);
  }

  // Create new session
  const newSession: UserSession = {
    sessionId: generateSessionId(),
    ownedPhotos: [],
    createdAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
    console.log('🆕 Created new session:', newSession.sessionId);
  } catch (error) {
    console.error('❌ Failed to save session to localStorage:', error);
  }

  return newSession;
};

// Get current session ID
export const getCurrentSessionId = (): string => {
  const session = getOrCreateSession();
  return session.sessionId;
};

// Add photo to owned photos list
export const addOwnedPhoto = (photoId: string): void => {
  try {
    const session = getOrCreateSession();
    
    // Avoid duplicates
    if (!session.ownedPhotos.includes(photoId)) {
      session.ownedPhotos.push(photoId);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      console.log('✅ Added photo to owned list:', photoId, '(total:', session.ownedPhotos.length, ')');
    }
  } catch (error) {
    console.error('❌ Failed to add owned photo:', error);
  }
};

// Remove photo from owned photos list
export const removeOwnedPhoto = (photoId: string): void => {
  try {
    const session = getOrCreateSession();
    const initialLength = session.ownedPhotos.length;
    
    session.ownedPhotos = session.ownedPhotos.filter(id => id !== photoId);
    
    if (session.ownedPhotos.length !== initialLength) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      console.log('✅ Removed photo from owned list:', photoId, '(remaining:', session.ownedPhotos.length, ')');
    }
  } catch (error) {
    console.error('❌ Failed to remove owned photo:', error);
  }
};

// Check if current user owns a photo
export const isPhotoOwned = (photoId: string): boolean => {
  try {
    const session = getOrCreateSession();
    const isOwned = session.ownedPhotos.includes(photoId);
    console.log('🔍 Ownership check for', photoId, ':', isOwned ? 'OWNED' : 'NOT OWNED');
    return isOwned;
  } catch (error) {
    console.error('❌ Failed to check photo ownership:', error);
    return false;
  }
};

// Check photo ownership details.
//
// This is a UI hint only — it decides whether to offer a delete affordance. The
// actual authorisation happens server-side in netlify/functions/delete-photo.js,
// which requires the session secret. Never gate anything destructive or billable
// on this function alone.
//
// The `uploaderSessionId` parameter is retained for call-site compatibility but
// is no longer compared: photo documents now store a hash of the session secret
// rather than the secret itself, so a plaintext comparison would never match.
// The local owned-photos list is the authoritative source for the UI, and it
// avoids a Firestore read per photo (finding UX-3).
export const getPhotoOwnership = (photoId: string, uploaderSessionId?: string): PhotoOwnership => {
  try {
    const currentSessionId = getCurrentSessionId();

    const isOwner = isPhotoOwned(photoId);

    return {
      canDelete: isOwner,
      isOwner: isOwner,
      sessionId: currentSessionId
    };
  } catch (error) {
    console.error('❌ Failed to get photo ownership:', error);
    return {
      canDelete: false,
      isOwner: false,
      sessionId: getCurrentSessionId()
    };
  }
};

// Get all owned photo IDs
export const getOwnedPhotoIds = (): string[] => {
  try {
    const session = getOrCreateSession();
    return [...session.ownedPhotos]; // Return a copy
  } catch (error) {
    console.error('❌ Failed to get owned photo IDs:', error);
    return [];
  }
};

// Clear session (for testing or user request)
export const clearSession = (): void => {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    console.log('🗑️ Session cleared');
  } catch (error) {
    console.error('❌ Failed to clear session:', error);
  }
};

// Get session info for debugging
export const getSessionInfo = (): { sessionId: string; ownedCount: number; createdAt: string } => {
  try {
    const session = getOrCreateSession();
    return {
      sessionId: session.sessionId,
      ownedCount: session.ownedPhotos.length,
      createdAt: session.createdAt
    };
  } catch (error) {
    console.error('❌ Failed to get session info:', error);
    return {
      sessionId: 'error',
      ownedCount: 0,
      createdAt: new Date().toISOString()
    };
  }
};
