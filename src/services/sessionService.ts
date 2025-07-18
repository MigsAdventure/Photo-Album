import { UserSession, PhotoOwnership } from '../types';

const SESSION_STORAGE_KEY = 'wedding-app-session';

// Generate a unique session ID
const generateSessionId = (): string => {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

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

// Check photo ownership details
export const getPhotoOwnership = (photoId: string, uploaderSessionId?: string): PhotoOwnership => {
  try {
    const currentSessionId = getCurrentSessionId();
    
    // Check if photo is in our owned list (fastest check)
    const isInOwnedList = isPhotoOwned(photoId);
    
    // Also check if the uploaderSessionId matches (for recently uploaded photos)
    const matchesUploader = Boolean(uploaderSessionId && uploaderSessionId === currentSessionId);
    
    const isOwner = isInOwnedList || matchesUploader;
    
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
