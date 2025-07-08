// SharedMoments Service Worker - Professional Upload Reliability
const CACHE_NAME = 'sharedmoments-v1';
const UPLOAD_QUEUE_NAME = 'upload-queue';

// Cache key files for offline access
const urlsToCache = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Service Worker: Installation complete');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker: Activation complete');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  // Only handle GET requests for caching
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
  );
});

// Background Sync for reliable uploads
self.addEventListener('sync', (event) => {
  console.log('🔄 Service Worker: Background sync triggered:', event.tag);
  
  if (event.tag === 'upload-photos') {
    event.waitUntil(processUploadQueue());
  }
});

// Message handling for upload queue management
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'QUEUE_UPLOAD':
      queueUpload(data);
      break;
    case 'CHECK_QUEUE_STATUS':
      checkQueueStatus(event.ports[0]);
      break;
    case 'CLEAR_QUEUE':
      clearUploadQueue();
      break;
    default:
      console.log('🤷 Service Worker: Unknown message type:', type);
  }
});

// Upload Queue Management
async function queueUpload(uploadData) {
  try {
    console.log('📝 Service Worker: Queuing upload:', uploadData.fileName);
    
    // Get existing queue
    const queue = await getUploadQueue();
    
    // Add new upload with retry count
    const queueItem = {
      id: Date.now() + Math.random(),
      ...uploadData,
      attempts: 0,
      maxAttempts: 5,
      status: 'queued',
      queuedAt: new Date().toISOString()
    };
    
    queue.push(queueItem);
    
    // Save updated queue
    await saveUploadQueue(queue);
    
    // Register background sync
    await self.registration.sync.register('upload-photos');
    
    console.log('✅ Service Worker: Upload queued successfully');
    
    // Notify main thread
    notifyClients({
      type: 'UPLOAD_QUEUED',
      data: { id: queueItem.id, fileName: uploadData.fileName }
    });
    
  } catch (error) {
    console.error('❌ Service Worker: Failed to queue upload:', error);
  }
}

async function processUploadQueue() {
  try {
    console.log('🚀 Service Worker: Processing upload queue...');
    
    const queue = await getUploadQueue();
    const pendingUploads = queue.filter(item => 
      item.status === 'queued' || item.status === 'retrying'
    );
    
    if (pendingUploads.length === 0) {
      console.log('📭 Service Worker: Upload queue is empty');
      return;
    }
    
    console.log(`📤 Service Worker: Processing ${pendingUploads.length} uploads`);
    
    // Process uploads one at a time for mobile stability
    for (const upload of pendingUploads) {
      await processUpload(upload);
      
      // Small delay between uploads
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Notify completion
    const completedCount = pendingUploads.filter(u => u.status === 'completed').length;
    if (completedCount > 0) {
      showNotification(`✅ ${completedCount} photos uploaded successfully!`);
    }
    
  } catch (error) {
    console.error('❌ Service Worker: Queue processing failed:', error);
  }
}

async function processUpload(uploadItem) {
  try {
    console.log(`🔄 Service Worker: Processing upload ${uploadItem.fileName} (attempt ${uploadItem.attempts + 1})`);
    
    // Update status
    uploadItem.status = 'uploading';
    uploadItem.attempts++;
    await updateQueueItem(uploadItem);
    
    // Notify progress
    notifyClients({
      type: 'UPLOAD_PROGRESS',
      data: { 
        id: uploadItem.id, 
        status: 'uploading', 
        attempts: uploadItem.attempts 
      }
    });
    
    // Create FormData from stored data
    const formData = new FormData();
    
    // Reconstruct file from base64 data
    const byteCharacters = atob(uploadItem.fileData);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const file = new File([byteArray], uploadItem.fileName, { type: uploadItem.fileType });
    
    formData.append('photo', file);
    formData.append('eventId', uploadItem.eventId);
    
    // Attempt upload with timeout
    const response = await uploadWithTimeout(formData, 60000); // 60 second timeout
    
    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
    
    const result = await response.json();
    
    // Success!
    uploadItem.status = 'completed';
    uploadItem.completedAt = new Date().toISOString();
    uploadItem.result = result;
    
    await updateQueueItem(uploadItem);
    
    console.log(`✅ Service Worker: Upload completed for ${uploadItem.fileName}`);
    
    // Notify success
    notifyClients({
      type: 'UPLOAD_COMPLETED',
      data: { 
        id: uploadItem.id, 
        fileName: uploadItem.fileName,
        url: result.url 
      }
    });
    
  } catch (error) {
    console.error(`❌ Service Worker: Upload failed for ${uploadItem.fileName}:`, error);
    
    // Check if we should retry
    if (uploadItem.attempts < uploadItem.maxAttempts) {
      uploadItem.status = 'retrying';
      uploadItem.lastError = error.message;
      
      console.log(`🔄 Service Worker: Will retry ${uploadItem.fileName} (${uploadItem.attempts}/${uploadItem.maxAttempts})`);
      
      // Exponential backoff delay
      const delay = Math.min(uploadItem.attempts * 2000, 10000);
      setTimeout(async () => {
        await updateQueueItem(uploadItem);
        await self.registration.sync.register('upload-photos');
      }, delay);
      
    } else {
      // Max attempts reached
      uploadItem.status = 'failed';
      uploadItem.lastError = error.message;
      uploadItem.failedAt = new Date().toISOString();
      
      await updateQueueItem(uploadItem);
      
      console.error(`💀 Service Worker: Upload permanently failed for ${uploadItem.fileName}`);
      
      // Notify failure
      notifyClients({
        type: 'UPLOAD_FAILED',
        data: { 
          id: uploadItem.id, 
          fileName: uploadItem.fileName,
          error: error.message 
        }
      });
    }
  }
}

async function uploadWithTimeout(formData, timeout) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.timeout = timeout;
    
    xhr.onload = () => {
      const response = new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText
      });
      resolve(response);
    };
    
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Upload timeout'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    
    xhr.open('POST', '/.netlify/functions/upload');
    xhr.setRequestHeader('X-Background-Upload', 'true');
    xhr.send(formData);
  });
}

// Queue persistence functions
async function getUploadQueue() {
  try {
    const cache = await caches.open(UPLOAD_QUEUE_NAME);
    const response = await cache.match('upload-queue');
    if (response) {
      return await response.json();
    }
    return [];
  } catch (error) {
    console.error('Failed to get upload queue:', error);
    return [];
  }
}

async function saveUploadQueue(queue) {
  try {
    const cache = await caches.open(UPLOAD_QUEUE_NAME);
    const response = new Response(JSON.stringify(queue));
    await cache.put('upload-queue', response);
  } catch (error) {
    console.error('Failed to save upload queue:', error);
  }
}

async function updateQueueItem(updatedItem) {
  const queue = await getUploadQueue();
  const index = queue.findIndex(item => item.id === updatedItem.id);
  if (index !== -1) {
    queue[index] = updatedItem;
    await saveUploadQueue(queue);
  }
}

async function clearUploadQueue() {
  try {
    const cache = await caches.open(UPLOAD_QUEUE_NAME);
    await cache.delete('upload-queue');
    console.log('🗑️ Service Worker: Upload queue cleared');
  } catch (error) {
    console.error('Failed to clear upload queue:', error);
  }
}

async function checkQueueStatus(port) {
  const queue = await getUploadQueue();
  const status = {
    total: queue.length,
    queued: queue.filter(item => item.status === 'queued').length,
    uploading: queue.filter(item => item.status === 'uploading').length,
    completed: queue.filter(item => item.status === 'completed').length,
    failed: queue.filter(item => item.status === 'failed').length,
    retrying: queue.filter(item => item.status === 'retrying').length
  };
  
  port.postMessage({ type: 'QUEUE_STATUS', data: status });
}

// Client notification helpers
function notifyClients(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage(message);
    });
  });
}

function showNotification(message) {
  if (Notification.permission === 'granted') {
    self.registration.showNotification('SharedMoments', {
      body: message,
      icon: '/logo192.png',
      badge: '/logo192.png',
      tag: 'upload-complete'
    });
  }
}

console.log('🎉 Service Worker: Loaded and ready for professional uploads!');
