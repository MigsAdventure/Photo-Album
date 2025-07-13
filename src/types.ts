// Base interface for all media (photos and videos)
export interface Media {
  id: string;
  url: string;
  uploadedAt: Date;
  eventId: string;
  fileName?: string;
  size?: number;
  r2Key?: string;
  contentType?: string;
  mediaType: 'photo' | 'video';
  
  // Video-specific properties
  duration?: number; // in seconds
  thumbnail?: string; // video preview image URL
  width?: number;
  height?: number;
}

// Legacy Photo interface - extends Media for backward compatibility
export interface Photo extends Media {
  mediaType: 'photo';
}

// New Video interface
export interface Video extends Media {
  mediaType: 'video';
  duration: number;
  thumbnail?: string;
}

export interface Event {
  id: string;
  title: string;
  date: string;
  createdAt: Date;
  isActive: boolean;
  organizerEmail: string; // Required for freemium model
  planType: 'free' | 'premium';
  photoLimit: number;
  photoCount: number;
  paymentId?: string; // GHL transaction ID
  customBranding?: EventBranding;
}

export interface EventBranding {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  organizerName?: string;
}

export interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'waiting' | 'compressing' | 'uploading' | 'completed' | 'error';
  error?: string;
  fileIndex: number;
  file?: File;
  isCamera?: boolean;
  canRetry?: boolean;
  mediaType?: 'photo' | 'video'; // Track what type of media is being uploaded
  duration?: number; // For video validation
}

export interface FileAnalysis {
  isCamera: boolean;
  isScreenshot: boolean;
  needsCompression: boolean;
  originalSize: number;
  estimatedCompressedSize?: number;
  mediaType: 'photo' | 'video';
  duration?: number; // For videos
  isValidDuration?: boolean; // For 10-minute limit validation
}

// Video processing utilities
export interface VideoProcessingOptions {
  maxDuration: number; // 600 seconds (10 minutes)
  maxWidth: number;
  maxHeight: number;
  quality: number; // 0.1 to 1.0
  format: 'webm' | 'mp4';
}

// Enhanced media upload configuration
export interface MediaUploadConfig {
  enablePhotos: boolean;
  enableVideos: boolean;
  maxPhotoSize: number; // bytes
  maxVideoSize: number; // bytes  
  maxVideoDuration: number; // seconds
  videoQuality: number;
  photoQuality: number;
}

// GoHighLevel integration types
export interface GHLOrder {
  contactId: string;
  locationId: string;
  amount: number;
  currency: string;
  eventId: string;
  eventTitle: string;
  organizerEmail: string;
}

export interface GHLPaymentData {
  orderId: string;
  transactionId: string;
  amount: number;
  status: 'completed' | 'failed' | 'pending';
  eventId: string;
  contactId: string;
}

export interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  currentPhotoCount: number;
  onUpgradeSuccess: () => void;
}
