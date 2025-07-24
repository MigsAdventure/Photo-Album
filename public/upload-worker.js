// Upload Service Worker - Handles background uploads when app is minimized
const WORKER_VERSION = '1.0.0';
const CACHE_NAME = 'upload-worker-v1';

console.log('🔧 Upload Service Worker loaded, version:', WORKER_VERSION);

// Import Firebase libraries for background uploads
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js');

let firebaseApp = null;
let storage = null;
let firestore = null;

// Message handler for upload requests
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  console.log('🔧 Service Worker received message:', type);
  
  switch (type) {
    case 'INIT_FIREBASE':
      await initializeFirebase(data.config);
      event.ports[0].postMessage({ type: 'FIREBASE_INITIALIZED' });
      break;
      
    case 'UPLOAD_FILE':
      await handleBackgroundUpload(data, event.ports[0]);
      break;
      
    case 'GET_UPLOAD_STATUS':
      // Return status of ongoing uploads
      event.ports[0].postMessage({ 
        type: 'UPLOAD_STATUS',
        activeUploads: getActiveUploads()
      });
      break;
  }
});

// Initialize Firebase in service worker
async function initializeFirebase(config) {
  try {
    if (!firebaseApp) {
      firebaseApp = firebase.initializeApp(config);
      storage = firebase.storage();
      firestore = firebase.firestore();
      console.log('✅ Firebase initialized in service worker');
    }
  } catch (error) {
    console.error('❌ Failed to initialize Firebase in service worker:', error);
    throw error;
  }
}

// Track active uploads
let activeUploads = new Map();

function getActiveUploads() {
  return Array.from(activeUploads.keys());
}

// Handle background upload
async function handleBackgroundUpload(uploadData, port) {
  const { file, eventId, fileName, sessionId, uploadId } = uploadData;
  
  console.log('🚀 Starting background upload:', fileName);
  
  try {
    // Add to active uploads
    activeUploads.set(uploadId, { fileName, startTime: Date.now() });
    
    // Notify upload started
    port.postMessage({
      type: 'UPLOAD_PROGRESS',
      uploadId,
      progress: 0,
      status: 'starting'
    });
    
    // Create file reference
    const photoId = generateUUID();
    const extension = fileName.split('.').pop() || 'jpg';
    const storageRef = storage.ref(`events/${eventId}/photos/${photoId}.${extension}`);
    
    // Add metadata for security rules
    const metadata = {
      customMetadata: {
        sessionId: sessionId,
        uploadedAt: new Date().toISOString()
      }
    };
    
    // Start resumable upload
    const uploadTask = storageRef.put(file, metadata);
    
    // Track progress
    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 90; // Reserve 10% for metadata
        port.postMessage({
          type: 'UPLOAD_PROGRESS',
          uploadId,
          progress: Math.round(progress),
          status: 'uploading',
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes
        });
      },
      (error) => {
        console.error('❌ Background upload failed:', error);
        activeUploads.delete(uploadId);
        port.postMessage({
          type: 'UPLOAD_ERROR',
          uploadId,
          error: error.message
        });
      },
      async () => {
        try {
          // Upload completed, get download URL
          const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
          
          // Save metadata to Firestore
          await firestore.collection('photos').add({
            id: photoId,
            url: downloadURL,
            uploadedAt: new Date(),
            eventId,
            fileName: fileName,
            size: file.size,
            contentType: file.type,
            storagePath: `events/${eventId}/photos/${photoId}.${extension}`,
            mediaType: file.type.startsWith('video/') ? 'video' : 'photo',
            uploadedBy: sessionId
          });
          
          // Remove from active uploads
          activeUploads.delete(uploadId);
          
          // Notify completion
          port.postMessage({
            type: 'UPLOAD_COMPLETE',
            uploadId,
            progress: 100,
            url: downloadURL,
            photoId
          });
          
          console.log('✅ Background upload completed:', fileName);
          
        } catch (error) {
          console.error('❌ Failed to save metadata:', error);
          activeUploads.delete(uploadId);
          port.postMessage({
            type: 'UPLOAD_ERROR',
            uploadId,
            error: 'Failed to save file metadata'
          });
        }
      }
    );
    
  } catch (error) {
    console.error('❌ Background upload setup failed:', error);
    activeUploads.delete(uploadId);
    port.postMessage({
      type: 'UPLOAD_ERROR',
      uploadId,
      error: error.message
    });
  }
}

// Generate UUID for photo IDs
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Handle install and activate events
self.addEventListener('install', (event) => {
  console.log('🔧 Upload Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('🔧 Upload Service Worker activated');
  event.waitUntil(clients.claim());
});

// Keep service worker alive during uploads
self.addEventListener('fetch', (event) => {
  // Intercept fetch requests if needed for upload optimization
  // For now, just let them pass through
  return;
});
