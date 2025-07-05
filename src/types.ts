export interface Photo {
  id: string;
  url: string;
  uploadedAt: Date;
  weddingId: string;
  fileName?: string;
  size?: number;
}

export interface Wedding {
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
