export interface Photo {
  id: string;
  url: string;
  uploadedAt: Date;
  eventId: string;
  fileName?: string;
  size?: number;
  r2Key?: string;
  contentType?: string;
}

export interface Event {
  id: string;
  title: string;
  date: string;
  createdAt: Date;
  isActive: boolean;
}

export interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
}
