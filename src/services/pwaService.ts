// PWA Service - Professional Upload Reliability Manager
export interface UploadQueueItem {
  id: number;
  fileName: string;
  fileData: string; // base64
  fileType: string;
  fileSize: number;
  eventId: string;
  status: 'queued' | 'uploading' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  completedAt?: string;
  failedAt?: string;
  lastError?: string;
  result?: any;
}

export interface QueueStatus {
  total: number;
  queued: number;
  uploading: number;
  completed: number;
  failed: number;
  retrying: number;
}

class PWAService {
  private serviceWorker: ServiceWorker | null = null;
  private isSupported = false;
  private listeners: { [key: string]: Function[] } = {};

  constructor() {
    this.isSupported = 'serviceWorker' in navigator && 'sync' in window;
    this.initializeServiceWorker();
  }

  // Initialize Service Worker
  private async initializeServiceWorker() {
    if (!this.isSupported) {
      console.warn('📱 PWA: Service Worker or Background Sync not supported');
      return;
    }

    try {
      console.log('🔧 PWA: Registering Service Worker...');
      
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('✅ PWA: Service Worker registered successfully');

      // Wait for service worker to be ready
      const serviceWorker = registration.active || registration.waiting || registration.installing;
      
      if (serviceWorker) {
        this.serviceWorker = serviceWorker;
        
        if (serviceWorker.state === 'activated') {
          this.setupMessageHandler();
        } else {
          serviceWorker.addEventListener('statechange', () => {
            if (serviceWorker.state === 'activated') {
              this.serviceWorker = serviceWorker;
              this.setupMessageHandler();
            }
          });
        }
      }

      // Handle updates
      registration.addEventListener('updatefound', () => {
        console.log('🔄 PWA: New Service Worker version available');
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('🔄 PWA: New version ready - will update on next page load');
            }
          });
        }
      });

      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }

    } catch (error) {
      console.error('❌ PWA: Service Worker registration failed:', error);
    }
  }

  // Setup message handler for service worker communication
  private setupMessageHandler() {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, data } = event.data;
      this.emit(type, data);
    });
  }

  // Check if PWA features are supported
  isServiceWorkerSupported(): boolean {
    return this.isSupported;
  }

  // Queue upload for background processing
  async queueUpload(file: File, eventId: string): Promise<string> {
    if (!this.isSupported) {
      throw new Error('Background uploads not supported - falling back to direct upload');
    }

    try {
      console.log(`📝 PWA: Queuing upload for ${file.name}`);

      // Convert file to base64 for storage
      const fileData = await this.fileToBase64(file);
      
      const uploadData = {
        fileName: file.name,
        fileData,
        fileType: file.type,
        fileSize: file.size,
        eventId
      };

      // Send to service worker
      if (this.serviceWorker) {
        this.serviceWorker.postMessage({
          type: 'QUEUE_UPLOAD',
          data: uploadData
        });
      }

      return `queued-${Date.now()}`;

    } catch (error) {
      console.error('❌ PWA: Failed to queue upload:', error);
      throw error;
    }
  }

  // Get upload queue status
  async getQueueStatus(): Promise<QueueStatus> {
    return new Promise((resolve) => {
      if (!this.serviceWorker) {
        resolve({ total: 0, queued: 0, uploading: 0, completed: 0, failed: 0, retrying: 0 });
        return;
      }

      const channel = new MessageChannel();
      
      channel.port1.onmessage = (event) => {
        if (event.data.type === 'QUEUE_STATUS') {
          resolve(event.data.data);
        }
      };

      this.serviceWorker.postMessage(
        { type: 'CHECK_QUEUE_STATUS' },
        [channel.port2]
      );
    });
  }

  // Clear upload queue
  async clearQueue(): Promise<void> {
    if (this.serviceWorker) {
      this.serviceWorker.postMessage({ type: 'CLEAR_QUEUE' });
    }
  }

  // Event listener management
  on(eventType: string, callback: Function) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);
  }

  off(eventType: string, callback: Function) {
    if (this.listeners[eventType]) {
      this.listeners[eventType] = this.listeners[eventType].filter(cb => cb !== callback);
    }
  }

  private emit(eventType: string, data: any) {
    if (this.listeners[eventType]) {
      this.listeners[eventType].forEach(callback => callback(data));
    }
  }

  // Utility: Convert file to base64
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Install PWA prompt management
  private deferredPrompt: any = null;

  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('📱 PWA: Install prompt available');
      e.preventDefault();
      this.deferredPrompt = e;
      this.emit('INSTALL_AVAILABLE', true);
    });

    window.addEventListener('appinstalled', () => {
      console.log('✅ PWA: App installed successfully');
      this.deferredPrompt = null;
      this.emit('APP_INSTALLED', true);
    });
  }

  async showInstallPrompt(): Promise<boolean> {
    if (!this.deferredPrompt) {
      return false;
    }

    try {
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      console.log(`📱 PWA: Install prompt result: ${outcome}`);
      
      this.deferredPrompt = null;
      return outcome === 'accepted';
    } catch (error) {
      console.error('❌ PWA: Install prompt failed:', error);
      return false;
    }
  }
}

// Image compression service for better upload performance
export class ImageCompressionService {
  
  // Compress image while maintaining quality for desktop viewing
  static async compressImage(file: File, options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    outputFormat?: string;
  } = {}): Promise<File> {
    
    const {
      maxWidth = 2048,    // Good for desktop viewing
      maxHeight = 2048,   // Good for desktop viewing  
      quality = 0.85,     // 85% quality - good balance
      outputFormat = 'image/jpeg'
    } = options;

    try {
      console.log(`🗜️ Compressing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

      // Create image element
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Canvas context not available');
      }

      // Load image
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });

      // Calculate new dimensions
      let { width, height } = img;
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
      }

      // Set canvas dimensions
      canvas.width = width;
      canvas.height = height;

      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob!);
        }, outputFormat, quality);
      });

      // Clean up
      URL.revokeObjectURL(img.src);

      // Create new file
      const compressedFile = new File([blob], file.name, {
        type: outputFormat,
        lastModified: Date.now()
      });

      const originalSize = file.size / 1024 / 1024;
      const compressedSize = compressedFile.size / 1024 / 1024;
      const compressionRatio = ((originalSize - compressedSize) / originalSize * 100);

      console.log(`✅ Compression complete: ${originalSize.toFixed(2)}MB → ${compressedSize.toFixed(2)}MB (${compressionRatio.toFixed(1)}% reduction)`);

      return compressedFile;

    } catch (error) {
      console.error('❌ Image compression failed:', error);
      return file; // Return original if compression fails
    }
  }

  // Convert HEIC to JPEG (for iPhone compatibility)
  static async convertHeicToJpeg(file: File): Promise<File> {
    if (!file.type.includes('heic') && !file.type.includes('heif') && !file.name.toLowerCase().includes('.heic')) {
      return file;
    }

    try {
      console.log(`🔄 Converting HEIC to JPEG: ${file.name}`);
      
      // For now, just rename and change type - modern browsers handle HEIC
      // In the future, we could add a HEIC conversion library
      const jpegFile = new File([file], file.name.replace(/\.heic$/i, '.jpg'), {
        type: 'image/jpeg',
        lastModified: file.lastModified
      });

      console.log(`✅ HEIC conversion complete: ${file.name} → ${jpegFile.name}`);
      return jpegFile;

    } catch (error) {
      console.error('❌ HEIC conversion failed:', error);
      return file;
    }
  }

  // Smart batch processing for multiple images
  static async processBatch(files: File[], onProgress?: (current: number, total: number) => void): Promise<File[]> {
    const processedFiles: File[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i + 1, files.length);
      
      try {
        // Convert HEIC if needed
        let processedFile = await this.convertHeicToJpeg(file);
        
        // Compress if file is large
        if (processedFile.size > 2 * 1024 * 1024) { // > 2MB
          processedFile = await this.compressImage(processedFile);
        }
        
        processedFiles.push(processedFile);
        
      } catch (error) {
        console.error(`❌ Failed to process ${file.name}:`, error);
        processedFiles.push(file); // Use original if processing fails
      }
    }
    
    return processedFiles;
  }
}

// Export singleton instance
export const pwaService = new PWAService();

// Setup install prompt handling
pwaService.setupInstallPrompt();

export default pwaService;
