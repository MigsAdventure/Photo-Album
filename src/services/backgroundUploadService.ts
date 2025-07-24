// Enhanced Background Upload Service - Direct Firebase with Service Worker support
import { getCurrentSessionId, addOwnedPhoto } from './sessionService';
import { incrementPhotoCount, canUploadPhoto, getEvent } from './photoService';

// Firebase config from environment
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

export interface EnhancedUploadProgress {
  uploadId: string;
  fileName: string;
  progress: number;
  status: 'waiting' | 'compressing' | 'uploading' | 'completed' | 'error';
  error?: string;
  fileIndex: number;
  file?: File;
  isCamera?: boolean;
  canRetry?: boolean;
  mediaType?: 'photo' | 'video';
  duration?: number;
  bytesTransferred?: number;
  totalBytes?: number;
  uploadMethod?: 'foreground' | 'background';
  startTime?: number;
}

export interface BackgroundUploadConfig {
  maxParallelUploads: number;
  enableBackgroundUploads: boolean;
  compressionQuality: number;
  retryAttempts: number;
  chunkSizeForLargeFiles: number;
}

class BackgroundUploadService {
  private serviceWorker: ServiceWorker | null = null;
  private messageChannel: MessageChannel | null = null;
  private activeUploads = new Map<string, EnhancedUploadProgress>();
  private uploadQueue: EnhancedUploadProgress[] = [];
  private config: BackgroundUploadConfig;
  private progressCallbacks = new Map<string, (progress: EnhancedUploadProgress) => void>();
  private isServiceWorkerReady = false;

  constructor(config?: Partial<BackgroundUploadConfig>) {
    this.config = {
      maxParallelUploads: 3,
      enableBackgroundUploads: true,
      compressionQuality: 0.8,
      retryAttempts: 3,
      chunkSizeForLargeFiles: 10 * 1024 * 1024, // 10MB chunks
      ...config
    };

    this.initializeServiceWorker();
  }

  // Initialize service worker for background uploads
  private async initializeServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator) || !this.config.enableBackgroundUploads) {
      console.log('🔧 Service Worker not available or disabled, using foreground uploads only');
      return;
    }

    try {
      console.log('🔧 Registering upload service worker...');
      const registration = await navigator.serviceWorker.register('/upload-worker.js');
      
      if (registration.active) {
        this.serviceWorker = registration.active;
      } else if (registration.installing) {
        this.serviceWorker = registration.installing;
      } else if (registration.waiting) {
        this.serviceWorker = registration.waiting;
      }

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;
      
      // Create message channel for communication
      this.messageChannel = new MessageChannel();
      this.messageChannel.port1.onmessage = this.handleServiceWorkerMessage.bind(this);

      // Initialize Firebase in service worker
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(
          {
            type: 'INIT_FIREBASE',
            data: { config: firebaseConfig }
          },
          [this.messageChannel.port2]
        );
      }

      this.isServiceWorkerReady = true;
      console.log('✅ Upload service worker ready');

    } catch (error) {
      console.warn('⚠️ Failed to initialize service worker:', error);
      console.log('🔄 Falling back to foreground uploads');
    }
  }

  // Handle messages from service worker
  private handleServiceWorkerMessage(event: MessageEvent): void {
    const { type, uploadId, progress, status, error, url, photoId } = event.data;
    
    console.log('📨 Service worker message:', type, uploadId);

    const upload = this.activeUploads.get(uploadId);
    if (!upload) return;

    switch (type) {
      case 'UPLOAD_PROGRESS':
        upload.progress = progress;
        upload.status = status;
        upload.bytesTransferred = event.data.bytesTransferred;
        upload.totalBytes = event.data.totalBytes;
        this.notifyProgress(upload);
        break;

      case 'UPLOAD_COMPLETE':
        upload.progress = 100;
        upload.status = 'completed';
        this.activeUploads.delete(uploadId);
        this.notifyProgress(upload);
        
        // Add to owned photos and increment count
        if (photoId) {
          addOwnedPhoto(photoId);
          incrementPhotoCount(upload.file?.name.includes('eventId') ? upload.file.name.split('_')[1] : '');
        }
        
        // Process next in queue
        this.processNextInQueue();
        break;

      case 'UPLOAD_ERROR':
        upload.status = 'error';
        upload.error = error;
        upload.canRetry = true;
        this.activeUploads.delete(uploadId);
        this.notifyProgress(upload);
        
        // Process next in queue
        this.processNextInQueue();
        break;
    }
  }

  // Notify progress callback
  private notifyProgress(upload: EnhancedUploadProgress): void {
    const callback = this.progressCallbacks.get(upload.uploadId);
    if (callback) {
      callback(upload);
    }
  }

  // Process next upload in queue
  private processNextInQueue(): void {
    const activeCount = this.activeUploads.size;
    const availableSlots = this.config.maxParallelUploads - activeCount;

    for (let i = 0; i < availableSlots && this.uploadQueue.length > 0; i++) {
      const nextUpload = this.uploadQueue.shift();
      if (nextUpload) {
        this.startSingleUpload(nextUpload);
      }
    }
  }

  // Start single upload (foreground or background)
  private async startSingleUpload(upload: EnhancedUploadProgress): Promise<void> {
    this.activeUploads.set(upload.uploadId, upload);
    
    try {
      // Determine upload method
      const useBackground = this.isServiceWorkerReady && 
                          this.config.enableBackgroundUploads && 
                          upload.file!.size > 5 * 1024 * 1024; // Use background for files > 5MB

      upload.uploadMethod = useBackground ? 'background' : 'foreground';
      upload.startTime = Date.now();

      console.log(`🚀 Starting ${upload.uploadMethod} upload:`, upload.fileName);

      if (useBackground) {
        await this.startBackgroundUpload(upload);
      } else {
        await this.startForegroundUpload(upload);
      }

    } catch (error) {
      console.error('❌ Upload start failed:', error);
      upload.status = 'error';
      upload.error = error instanceof Error ? error.message : 'Upload failed to start';
      upload.canRetry = true;
      this.activeUploads.delete(upload.uploadId);
      this.notifyProgress(upload);
      this.processNextInQueue();
    }
  }

  // Start background upload via service worker
  private async startBackgroundUpload(upload: EnhancedUploadProgress): Promise<void> {
    if (!this.messageChannel || !navigator.serviceWorker.controller) {
      throw new Error('Service worker not available');
    }

    const eventId = this.extractEventId(upload);
    const sessionId = getCurrentSessionId();

    navigator.serviceWorker.controller.postMessage({
      type: 'UPLOAD_FILE',
      data: {
        file: upload.file,
        eventId,
        fileName: upload.fileName,
        sessionId,
        uploadId: upload.uploadId
      }
    }, [this.messageChannel.port2]);
  }

  // Start foreground upload (direct Firebase)
  private async startForegroundUpload(upload: EnhancedUploadProgress): Promise<void> {
    const { ref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('../firebase');
    const { collection, addDoc } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    const { v4: uuidv4 } = await import('uuid');

    const eventId = this.extractEventId(upload);
    const sessionId = getCurrentSessionId();
    const photoId = uuidv4();
    const extension = upload.fileName.split('.').pop() || 'jpg';
    const storageRef = ref(storage, `events/${eventId}/photos/${photoId}.${extension}`);

    // Compress if needed
    let fileToUpload = upload.file!;
    if (upload.isCamera && upload.file!.size > 8 * 1024 * 1024 && upload.mediaType === 'photo') {
      upload.status = 'compressing';
      this.notifyProgress(upload);
      fileToUpload = await this.compressImage(upload.file!, this.config.compressionQuality);
    }

    const metadata = {
      customMetadata: {
        sessionId: sessionId,
        uploadedAt: new Date().toISOString()
      }
    };

    const uploadTask = uploadBytesResumable(storageRef, fileToUpload, metadata);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 90;
        upload.progress = Math.round(progress);
        upload.status = 'uploading';
        upload.bytesTransferred = snapshot.bytesTransferred;
        upload.totalBytes = snapshot.totalBytes;
        this.notifyProgress(upload);
      },
      (error) => {
        console.error('❌ Foreground upload error:', error);
        upload.status = 'error';
        upload.error = error.message;
        upload.canRetry = true;
        this.activeUploads.delete(upload.uploadId);
        this.notifyProgress(upload);
        this.processNextInQueue();
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          
          // Save to Firestore
          const docRef = await addDoc(collection(db, 'photos'), {
            id: photoId,
            url: downloadURL,
            uploadedAt: new Date(),
            eventId,
            fileName: upload.fileName,
            size: fileToUpload.size,
            contentType: fileToUpload.type,
            storagePath: `events/${eventId}/photos/${photoId}.${extension}`,
            mediaType: upload.mediaType || 'photo',
            uploadedBy: sessionId
          });

          // Complete upload
          upload.progress = 100;
          upload.status = 'completed';
          this.activeUploads.delete(upload.uploadId);
          
          // Add to owned photos and increment count
          addOwnedPhoto(docRef.id);
          await incrementPhotoCount(eventId);
          
          this.notifyProgress(upload);
          this.processNextInQueue();

        } catch (error) {
          console.error('❌ Failed to save metadata:', error);
          upload.status = 'error';
          upload.error = 'Failed to save file metadata';
          upload.canRetry = true;
          this.activeUploads.delete(upload.uploadId);
          this.notifyProgress(upload);
          this.processNextInQueue();
        }
      }
    );
  }

  // Extract event ID from upload context
  private extractEventId(upload: EnhancedUploadProgress): string {
    // Use the eventId stored with the upload object
    return (upload as any).eventId || 'default-event';
  }

  // Compress image for faster upload
  private compressImage(file: File, quality: number): Promise<File> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        const maxWidth = 1920;
        const maxHeight = 1080;
        let { width, height } = img;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };
      
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  // Public API: Upload multiple files with parallel processing
  public async uploadFiles(
    files: FileList | File[],
    eventId: string,
    onProgress: (uploads: EnhancedUploadProgress[]) => void
  ): Promise<void> {
    console.log(`🚀 Starting parallel upload of ${files.length} files to event: ${eventId}`);

    // Check freemium limits
    const canUpload = await canUploadPhoto(eventId);
    if (!canUpload) {
      const event = await getEvent(eventId);
      throw new Error(`Upload limit reached! You have uploaded ${event?.photoCount || 0}/${event?.photoLimit || 2} photos. Upgrade to premium for unlimited uploads.`);
    }

    // Convert FileList to Array and create upload objects
    const fileArray = Array.from(files);
    const uploads: EnhancedUploadProgress[] = fileArray.map((file, index) => {
      const uploadId = `upload_${Date.now()}_${index}`;
      const analysis = this.analyzeFile(file);
      
      return {
        uploadId,
        fileName: file.name,
        progress: 0,
        status: 'waiting' as const,
        fileIndex: index,
        file,
        isCamera: analysis.isCamera,
        mediaType: analysis.mediaType,
        canRetry: false,
        eventId // Store eventId with upload
      } as EnhancedUploadProgress & { eventId: string };
    });

    // Set up progress tracking
    uploads.forEach(upload => {
      this.progressCallbacks.set(upload.uploadId, () => {
        onProgress([...this.uploadQueue, ...Array.from(this.activeUploads.values())]);
      });
    });

    // Add to queue
    this.uploadQueue.push(...uploads);

    // Start processing
    this.processNextInQueue();

    // Initial progress callback
    onProgress(uploads);
  }

  // Analyze file to determine properties
  private analyzeFile(file: File): { isCamera: boolean; mediaType: 'photo' | 'video' } {
    const sizeMB = file.size / 1024 / 1024;
    const isVideo = file.type.startsWith('video/') || 
                   file.name.toLowerCase().match(/\.(mp4|mov|webm|avi|3gp|wmv)$/);
    
    const isCamera = isVideo ? 
      sizeMB > 10 : // Camera videos are usually >10MB
      (
        sizeMB > 3 || // Camera photos are usually >3MB
        file.name.toLowerCase().includes('img_') || // iOS camera naming
        file.name.toLowerCase().includes('dsc') || // Camera naming
        (file.type === 'image/jpeg' && sizeMB > 1.5) // Large JPEG likely camera
      );
    
    return { 
      isCamera, 
      mediaType: isVideo ? 'video' : 'photo' 
    };
  }

  // Public API: Retry failed upload
  public async retryUpload(uploadId: string): Promise<void> {
    const callback = this.progressCallbacks.get(uploadId);
    if (!callback) {
      throw new Error('Upload not found');
    }

    // Find upload in current progress state and retry
    const allUploads = [...this.uploadQueue, ...Array.from(this.activeUploads.values())];
    const upload = allUploads.find(u => u.uploadId === uploadId);
    
    if (upload && upload.status === 'error') {
      upload.status = 'waiting';
      upload.error = undefined;
      upload.canRetry = false;
      upload.progress = 0;
      
      this.uploadQueue.push(upload);
      this.processNextInQueue();
    }
  }

  // Public API: Cancel upload
  public cancelUpload(uploadId: string): void {
    // Remove from queue if waiting
    this.uploadQueue = this.uploadQueue.filter(u => u.uploadId !== uploadId);
    
    // Cancel if active (implementation depends on upload method)
    this.activeUploads.delete(uploadId);
    this.progressCallbacks.delete(uploadId);
  }

  // Public API: Get upload statistics
  public getUploadStats(): {
    active: number;
    queued: number;
    completed: number;
    failed: number;
  } {
    const active = this.activeUploads.size;
    const queued = this.uploadQueue.length;
    
    return { active, queued, completed: 0, failed: 0 };
  }
}

// Export singleton instance
export const backgroundUploadService = new BackgroundUploadService();

// Export helper functions
export const uploadFilesWithBackground = backgroundUploadService.uploadFiles.bind(backgroundUploadService);
export const retryBackgroundUpload = backgroundUploadService.retryUpload.bind(backgroundUploadService);
export const cancelBackgroundUpload = backgroundUploadService.cancelUpload.bind(backgroundUploadService);
export const getBackgroundUploadStats = backgroundUploadService.getUploadStats.bind(backgroundUploadService);
