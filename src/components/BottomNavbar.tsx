import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  LinearProgress,
  useTheme,
  alpha,
  useMediaQuery,
  TextField,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  PhotoCamera,
  PhotoLibrary,
  FileDownload,
  QrCode,
  Close,
  Download,
  ContentCopy,
  Refresh,
  Delete,
  CheckCircle,
  Error as ErrorIcon,
  Email,
  GetApp,
  Print
} from '@mui/icons-material';
import { uploadMedia, validateMediaFile } from '../services/mediaUploadService';
import { requestEmailDownload, getEvent, canUploadPhoto } from '../services/photoService';
import { Photo, UploadProgress, Event } from '../types';
import UpgradeModal from './UpgradeModal';
import QRCode from 'qrcode';

interface BottomNavbarProps {
  photos: Photo[];
  eventId: string;
  onUploadComplete?: () => void;
}

const BottomNavbar: React.FC<BottomNavbarProps> = ({ photos, eventId, onUploadComplete }) => {
  // Email download state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState('');
  
  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  
  // QR code state
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Freemium state
  const [event, setEvent] = useState<Event | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const eventUrl = `${window.location.origin}/event/${eventId}`;

  // Load event data for freemium checking
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const eventData = await getEvent(eventId);
        setEvent(eventData);
      } catch (error) {
        console.error('Failed to load event for freemium check:', error);
      }
    };
    
    loadEvent();
  }, [eventId]);

  // Check if upload is allowed (freemium limits)
  const checkUploadAllowed = async (): Promise<boolean> => {
    if (!event) return false;
    
    const canUpload = await canUploadPhoto(eventId);
    if (!canUpload) {
      setShowUpgradeModal(true);
      return false;
    }
    
    return true;
  };

  // Generate file fingerprint to prevent duplicates
  const generateFileFingerprint = useCallback(async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }, []);

  // Analyze file to determine if it's a camera photo vs screenshot
  const analyzeFile = useCallback((file: File): { isCamera: boolean; needsCompression: boolean } => {
    const sizeMB = file.size / 1024 / 1024;
    
    // Heuristics to detect camera photos vs screenshots
    const isCamera = (
      sizeMB > 3 || // Camera photos are usually >3MB
      file.name.toLowerCase().includes('img_') || // iOS camera naming
      file.name.toLowerCase().includes('dsc') || // Camera naming
      (file.type === 'image/jpeg' && sizeMB > 1.5) // Large JPEG likely camera
    );
    
    const needsCompression = isCamera && sizeMB > 8;
    
    return { isCamera, needsCompression };
  }, []);

  // Validate file before upload using the new media validation
  const validateFile = useCallback(async (file: File): Promise<{ valid: boolean; error?: string }> => {
    try {
      const validation = await validateMediaFile(file);
      return { valid: validation.isValid, error: validation.error };
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Validation failed' 
      };
    }
  }, []);

  // Compress large camera photos
  const compressImage = useCallback(async (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // More aggressive compression for camera photos
        const maxWidth = 1280;
        const maxHeight = 720;
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
        
        // Draw and compress aggressively for camera photos
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              console.log(`📷 Camera photo compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.6 // More aggressive 60% quality for camera photos
        );
      };
      
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }, []);

  // Less aggressive compression for retry attempts
  const compressImageForRetry = useCallback(async (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // Less aggressive compression for retries
        const maxWidth = 1600; // Larger than initial attempt
        const maxHeight = 900;
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
        
        // Draw and compress less aggressively for retries
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              console.log(`🔄 Retry compression: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.7 // Less aggressive 70% quality for retries
        );
      };
      
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }, []);

  // Sequential upload processing - simplified approach
  const startUploads = useCallback(async (queue: UploadProgress[]) => {
    console.log('🚀 Starting sequential upload processing...', queue.length, 'files');
    
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      
      try {
        console.log(`📤 Processing upload ${i + 1}/${queue.length}: ${item.fileName}`);
        
        // Update status to show this file is active
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === i ? { ...q, status: 'uploading', progress: 0, error: undefined } : q
          )
        );

        let fileToUpload = item.file!;
        
        // Compress if needed
        if (item.isCamera && item.file!.size > 8 * 1024 * 1024) {
          console.log(`🗜️ Compressing camera photo: ${item.fileName}`);
          setUploadProgress(prev => 
            prev.map((q, idx) => 
              idx === i ? { ...q, status: 'compressing', progress: 20 } : q
            )
          );
          
          fileToUpload = await compressImage(item.file!);
          
          setUploadProgress(prev => 
            prev.map((q, idx) => 
              idx === i ? { ...q, status: 'uploading', progress: 30 } : q
            )
          );
        }

        // Upload the file
        console.log(`⬆️ Starting upload: ${item.fileName}`);
        await uploadMedia(fileToUpload, eventId, (progress: number) => {
          setUploadProgress(prev => 
            prev.map((q, idx) => 
              idx === i ? { ...q, progress: Math.max(progress, 30) } : q
            )
          );
        });
        
        // Mark as completed
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === i ? { ...q, status: 'completed', progress: 100 } : q
          )
        );
        
        console.log(`✅ Upload ${i + 1}/${queue.length} completed: ${item.fileName}`);
        
        // Delay between uploads for stability
        if (i < queue.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ Upload ${i + 1}/${queue.length} failed:`, error);
        
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === i ? { 
              ...q, 
              status: 'error',
              progress: 0,
              error: error instanceof Error ? error.message : 'Upload failed',
              canRetry: true
            } : q
          )
        );
      }
    }
    
    // Check if all completed
    setUploadProgress(current => {
      const allCompleted = current.every(item => item.status === 'completed');
      if (allCompleted && current.length > 0) {
        console.log('🎉 All uploads completed!');
        setTimeout(() => {
          setUploadProgress([]);
          onUploadComplete?.();
        }, 3000);
      }
      setUploading(false);
      return current;
    });
  }, [eventId, onUploadComplete, compressImage]);

  const handleFileSelect = async (files: FileList) => {
    // Check freemium limits before processing files
    const canUpload = await checkUploadAllowed();
    if (!canUpload) {
      return; // Upload blocked due to freemium limits
    }

    const mediaFiles = Array.from(files).filter(file => 
      file.type.startsWith('image/') || file.type.startsWith('video/') || file.type === '' || 
      file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|heic|heif|mp4|mov|avi|webm)$/)
    );

    if (mediaFiles.length === 0) {
      alert('Please select valid image or video files');
      return;
    }

    console.log('📤 Media files selected for validation and upload:', mediaFiles.length);

    // Create initial queue with validation status
    const initialQueue: UploadProgress[] = mediaFiles.map((file, index) => {
      const analysis = analyzeFile(file);
      
      return {
        fileName: file.name,
        progress: 0,
        status: 'waiting' as const,
        fileIndex: index,
        file,
        isCamera: analysis.isCamera,
        canRetry: false
      };
    });

    setUploadProgress(initialQueue);
    setUploading(true);

    // Validate files and detect duplicates
    const validatedQueue: UploadProgress[] = [];
    const seenFingerprints = new Set<string>();
    let hasErrors = false;

    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      
      try {
        // Update status to show validation in progress
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === i ? { ...q, status: 'uploading', progress: 5 } : q
          )
        );

        console.log(`🔍 Validating file ${i + 1}/${mediaFiles.length}: ${file.name}`);

        // Validate file
        const validation = await validateFile(file);
        if (!validation.valid) {
          console.error(`❌ File validation failed: ${file.name} - ${validation.error}`);
          setUploadProgress(prev => 
            prev.map((q, idx) => 
              idx === i ? { 
                ...q, 
                status: 'error',
                progress: 0,
                error: validation.error,
                canRetry: false
              } : q
            )
          );
          hasErrors = true;
          continue;
        }

        // Generate fingerprint to check for duplicates
        const fingerprint = await generateFileFingerprint(file);
        if (seenFingerprints.has(fingerprint)) {
          console.warn(`⚠️ Duplicate file detected: ${file.name}`);
          setUploadProgress(prev => 
            prev.map((q, idx) => 
              idx === i ? { 
                ...q, 
                status: 'error',
                progress: 0,
                error: 'Duplicate file (already selected)',
                canRetry: false
              } : q
            )
          );
          hasErrors = true;
          continue;
        }

        seenFingerprints.add(fingerprint);

        // File is valid and unique
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === i ? { ...q, status: 'waiting', progress: 0 } : q
          )
        );

        const analysis = analyzeFile(file);
        validatedQueue.push({
          fileName: file.name,
          progress: 0,
          status: 'waiting' as const,
          fileIndex: i,
          file,
          isCamera: analysis.isCamera,
          canRetry: false
        });

        console.log(`✅ File validated: ${file.name} (${analysis.isCamera ? 'camera' : 'screenshot'})`);

      } catch (error) {
        console.error(`❌ Validation error for ${file.name}:`, error);
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === i ? { 
              ...q, 
              status: 'error',
              progress: 0,
              error: 'Validation failed',
              canRetry: false
            } : q
          )
        );
        hasErrors = true;
      }
    }

    if (validatedQueue.length === 0) {
      console.error('❌ No valid files to upload');
      setUploading(false);
      alert('No valid files to upload. Please check the files and try again.');
      return;
    }

    if (hasErrors) {
      console.warn(`⚠️ ${mediaFiles.length - validatedQueue.length} files failed validation`);
    }

    console.log(`🚀 Starting upload for ${validatedQueue.length} validated files`);
    
    // Start processing validated files
    setTimeout(() => startUploads(validatedQueue), 500);
  };

  // Individual file retry - ONLY retries the specific failed file
  const retryUpload = useCallback(async (fileIndex: number) => {
    setUploadProgress(prev => 
      prev.map((item, idx) => 
        idx === fileIndex ? { 
          ...item, 
          status: 'uploading' as const,
          progress: 0,
          error: undefined,
          canRetry: false
        } : item
      )
    );

    // Get the specific file to retry
    const fileToRetry = uploadProgress[fileIndex];
    if (!fileToRetry) return;

    console.log(`🔄 RETRYING INDIVIDUAL FILE: ${fileToRetry.fileName}`);

    try {
      let fileToUpload = fileToRetry.file!;
      
      // Compress if needed (less aggressive on retry)
      if (fileToRetry.isCamera && fileToRetry.file!.size > 8 * 1024 * 1024) {
        console.log(`🗜️ Compressing for retry: ${fileToRetry.fileName}`);
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === fileIndex ? { ...q, status: 'compressing', progress: 20 } : q
          )
        );
        
        // Less aggressive compression on retry (70% instead of 60%)
        fileToUpload = await compressImageForRetry(fileToRetry.file!);
        
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === fileIndex ? { ...q, status: 'uploading', progress: 30 } : q
          )
        );
      }

      // Upload just this file
      await uploadMedia(fileToUpload, eventId, (progress: number) => {
        setUploadProgress(prev => 
          prev.map((q, idx) => 
            idx === fileIndex ? { ...q, progress: Math.max(progress, 30) } : q
          )
        );
      });
      
      // Mark as completed
      setUploadProgress(prev => 
        prev.map((q, idx) => 
          idx === fileIndex ? { ...q, status: 'completed', progress: 100 } : q
        )
      );
      
      console.log(`✅ Individual retry completed: ${fileToRetry.fileName}`);
      
    } catch (error) {
      console.error(`❌ Individual retry failed: ${fileToRetry.fileName}`, error);
      
      setUploadProgress(prev => 
        prev.map((q, idx) => 
          idx === fileIndex ? { 
            ...q, 
            status: 'error',
            progress: 0,
            error: error instanceof Error ? error.message : 'Retry failed',
            canRetry: true
          } : q
        )
      );
    }
  }, [uploadProgress, eventId, compressImageForRetry]);

  const removeFromQueue = useCallback((fileIndex: number) => {
    setUploadProgress(prev => prev.filter((_, idx) => idx !== fileIndex));
  }, []);

  const handleCameraClick = async () => {
    // Check freemium limits BEFORE opening file picker
    const canUpload = await checkUploadAllowed();
    if (!canUpload) {
      return; // Upload blocked due to freemium limits - modal already shown
    }
    
    // For mobile devices, try to access camera directly using getUserMedia
    if (/Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try {
        // Try to access camera directly
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          console.log('📱 Attempting direct camera access...');
          
          // Request camera permission and access
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: 'environment', // Use back camera
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            } 
          });
          
          // Create a temporary video element to capture the stream
          const video = document.createElement('video');
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          video.srcObject = stream;
          video.autoplay = true;
          video.playsInline = true;
          
          // Create a fullscreen camera interface with overlay buttons
          const cameraDialog = document.createElement('div');
          cameraDialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 9999;
            overflow: hidden;
          `;
          
          video.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            object-fit: cover;
          `;
          
          // Create exit button (top-right corner)
          const exitButton = document.createElement('div');
          exitButton.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            width: 56px;
            height: 56px;
            background: rgba(244, 67, 54, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            transition: all 0.2s ease;
          `;
          
          exitButton.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          `;
          
          // Create capture button (bottom-center)
          const captureButton = document.createElement('div');
          captureButton.style.cssText = `
            position: absolute;
            bottom: 48px;
            left: 50%;
            transform: translateX(-50%);
            width: 80px;
            height: 80px;
            background: rgba(233, 30, 99, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            z-index: 10000;
            transition: all 0.2s ease;
          `;
          
          captureButton.innerHTML = `
            <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
              <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M17,3H7A2,2 0 0,0 5,5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V5A2,2 0 0,0 17,3M17,19H7V5H17V19Z"/>
            </svg>
          `;
          
          // Add hover effects
          captureButton.onmouseenter = () => {
            captureButton.style.transform = 'translateX(-50%) scale(1.1)';
            captureButton.style.background = 'rgba(233, 30, 99, 1)';
          };
          
          captureButton.onmouseleave = () => {
            captureButton.style.transform = 'translateX(-50%) scale(1)';
            captureButton.style.background = 'rgba(233, 30, 99, 0.9)';
          };
          
          exitButton.onmouseenter = () => {
            exitButton.style.transform = 'scale(1.1)';
            exitButton.style.background = 'rgba(244, 67, 54, 1)';
          };
          
          exitButton.onmouseleave = () => {
            exitButton.style.transform = 'scale(1)';
            exitButton.style.background = 'rgba(244, 67, 54, 0.9)';
          };
          
          // Handle capture
          captureButton.onclick = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx?.drawImage(video, 0, 0);
            
            canvas.toBlob(async (blob) => {
              if (blob) {
                const file = new File([blob], `camera-photo-${Date.now()}.jpg`, {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                
                // Clean up
                stream.getTracks().forEach(track => track.stop());
                document.body.removeChild(cameraDialog);
                
                // Upload the captured photo
                const dt = new DataTransfer();
                dt.items.add(file);
                await handleFileSelect(dt.files);
              }
            }, 'image/jpeg', 0.8);
          };
          
          // Handle exit
          exitButton.onclick = () => {
            stream.getTracks().forEach(track => track.stop());
            document.body.removeChild(cameraDialog);
          };
          
          cameraDialog.appendChild(video);
          cameraDialog.appendChild(captureButton);
          cameraDialog.appendChild(exitButton);
          document.body.appendChild(cameraDialog);
          
          return;
        }
      } catch (error) {
        console.warn('📱 Direct camera access failed:', error);
        // Fall back to file input method
      }
    }
    
    // Fallback: Use file input with multiple attempts for better camera access
    console.log('📱 Falling back to file input method');
    
    // Try different approaches for mobile camera access
    const cameraInput = document.getElementById('bottom-camera-input') as HTMLInputElement;
    if (cameraInput) {
      // Reset the input to ensure change event fires
      cameraInput.value = '';
      
      // For mobile, create a fresh input element with camera-specific attributes
      if (/Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        const newInput = document.createElement('input');
        newInput.type = 'file';
        newInput.accept = 'image/*';
        newInput.capture = 'environment' as any; // Force rear camera
        newInput.style.display = 'none';
        newInput.onchange = (e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files) {
            handleFileSelect(files);
          }
          document.body.removeChild(newInput);
        };
        document.body.appendChild(newInput);
        newInput.click();
      } else {
        cameraInput.click();
      }
    }
  };

  const handleGalleryClick = async () => {
    // Check freemium limits BEFORE opening file picker
    const canUpload = await checkUploadAllowed();
    if (!canUpload) {
      return; // Upload blocked due to freemium limits - modal already shown
    }
    
    const galleryInput = document.getElementById('bottom-gallery-input') as HTMLInputElement;
    galleryInput?.click();
  };

  const handleDownloadClick = () => {
    if (photos.length === 0) {
      alert('No photos to download');
      return;
    }
    setEmailDialogOpen(true);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      handleFileSelect(files);
    }
  };

  // QR Code functionality
  useEffect(() => {
    if (showQRDialog && eventUrl) {
      // Use a longer delay and ensure the canvas exists
      const timer = setTimeout(() => {
        if (qrCanvasRef.current) {
          console.log('Generating QR code for:', eventUrl);
          QRCode.toCanvas(qrCanvasRef.current, eventUrl, {
            width: isMobile ? 200 : 300,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#FFFFFF',
            },
          }, (error: Error | null | undefined) => {
            if (error) {
              console.error('QR code generation error:', error);
            } else {
              console.log('QR code generated successfully');
            }
          });
        } else {
          console.warn('Canvas ref not available for QR code generation');
        }
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [showQRDialog, eventUrl, isMobile]);

  const downloadQR = () => {
    if (qrCanvasRef.current) {
      const link = document.createElement('a');
      link.download = `event-qr-code.png`;
      link.href = qrCanvasRef.current.toDataURL();
      link.click();
    }
  };

  const copyQRLink = async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    } catch (error) {
      console.error('Failed to copy link:', error);
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = eventUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    }
  };

  return (
    <>
      {/* Hidden file inputs */}
      <input
        id="bottom-camera-input"
        type="file"
        accept="image/*,image/heic,image/heif"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        capture
      />
      
      <input
        id="bottom-gallery-input"
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Bottom Navigation Bar */}
      <Paper
        elevation={8}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          borderRadius: 0,
          bgcolor: 'background.paper',
          borderTop: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            py: 1,
            px: 2,
            minHeight: 70
          }}
        >
          {/* Camera Button */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <IconButton
              onClick={handleCameraClick}
              sx={{
                bgcolor: theme.palette.primary.main,
                color: 'white',
                width: 48,
                height: 48,
                mb: 0.5,
                '&:hover': {
                  bgcolor: theme.palette.primary.dark,
                }
              }}
            >
              <PhotoCamera />
            </IconButton>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
              Take Photo
            </Typography>
          </Box>

          {/* Gallery Button */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <IconButton
              onClick={handleGalleryClick}
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                color: theme.palette.primary.main,
                width: 48,
                height: 48,
                mb: 0.5,
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.2),
                }
              }}
            >
              <PhotoLibrary />
            </IconButton>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
              Gallery
            </Typography>
          </Box>

          {/* QR Code Button */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <IconButton
              onClick={() => setShowQRDialog(true)}
              sx={{
                bgcolor: alpha(theme.palette.info.main, 0.1),
                color: theme.palette.info.main,
                width: 48,
                height: 48,
                mb: 0.5,
                '&:hover': {
                  bgcolor: alpha(theme.palette.info.main, 0.2),
                }
              }}
            >
              <QrCode />
            </IconButton>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
              QR Code
            </Typography>
          </Box>

          {/* Download All Button */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <IconButton
              onClick={handleDownloadClick}
              disabled={photos.length === 0}
              sx={{
                bgcolor: photos.length > 0 ? alpha(theme.palette.success.main, 0.1) : alpha(theme.palette.grey[500], 0.1),
                color: photos.length > 0 ? theme.palette.success.main : theme.palette.grey[500],
                width: 48,
                height: 48,
                mb: 0.5,
                '&:hover': {
                  bgcolor: photos.length > 0 ? alpha(theme.palette.success.main, 0.2) : alpha(theme.palette.grey[500], 0.1),
                }
              }}
            >
              <FileDownload />
            </IconButton>
            <Typography 
              variant="caption" 
              sx={{ 
                fontSize: '0.7rem', 
                color: photos.length > 0 ? 'text.secondary' : 'text.disabled' 
              }}
            >
              Download All
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* Professional Email Download Dialog */}
      <Dialog
        open={emailDialogOpen}
        onClose={() => {
          setEmailDialogOpen(false);
          setEmail('');
          setEmailError('');
          setEmailSuccess(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          <Email sx={{ mr: 1, color: 'primary.main' }} />
          Download All Photos
        </DialogTitle>
        
        <DialogContent>
          {emailSuccess ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              🎉 Download link sent successfully! Check your email for the download link.
            </Alert>
          ) : (
            <>
              <Typography variant="body1" sx={{ mb: 3 }}>
                We'll create a ZIP file with all {photos.length} photos and email you a download link.
              </Typography>
              
              <Alert severity="info" sx={{ mb: 3 }}>
                📧 Photos are available for download for one full year from the event date.
              </Alert>
              
              <TextField
                autoFocus
                margin="dense"
                label="Your email address"
                type="email"
                fullWidth
                variant="outlined"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={emailLoading}
                error={!!emailError}
                helperText={emailError || 'We\'ll only use this to send you the download link'}
                placeholder="example@email.com"
              />
            </>
          )}
        </DialogContent>
        
        <DialogActions sx={{ px: 3, pb: 3 }}>
          {emailSuccess ? (
            <Button
              onClick={() => {
                setEmailDialogOpen(false);
                setEmail('');
                setEmailError('');
                setEmailSuccess(false);
              }}
              variant="contained"
              fullWidth
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                onClick={() => {
                  setEmailDialogOpen(false);
                  setEmail('');
                  setEmailError('');
                }}
                disabled={emailLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!email) {
                    setEmailError('Email address is required');
                    return;
                  }
                  
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    setEmailError('Please enter a valid email address');
                    return;
                  }
                  
                  setEmailLoading(true);
                  setEmailError('');
                  
                  try {
                    await requestEmailDownload(eventId, email);
                    setEmailSuccess(true);
                    console.log('✅ Email download request sent successfully');
                  } catch (error: any) {
                    console.error('❌ Email download request failed:', error);
                    setEmailError(error.message || 'Failed to send download request. Please try again.');
                  } finally {
                    setEmailLoading(false);
                  }
                }}
                variant="contained"
                disabled={emailLoading || !email}
                startIcon={emailLoading ? <CircularProgress size={20} /> : <GetApp />}
              >
                {emailLoading ? 'Preparing Download...' : 'Send Download Link'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Upload Progress Dialog with Retry Functionality */}
      <Dialog 
        open={uploading || uploadProgress.length > 0} 
        sx={{ zIndex: 1500 }} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: {
            margin: { xs: 1, sm: 3 },
            maxWidth: { xs: 'calc(100vw - 16px)', sm: '600px' },
            width: '100%'
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">Uploading Photos</Typography>
            <Typography variant="caption" color="text.secondary">
              {uploadProgress.filter(p => p.status === 'completed').length} of {uploadProgress.length} completed
            </Typography>
          </Box>
          {!uploading && uploadProgress.every(p => p.status === 'completed' || p.status === 'error') && (
            <IconButton onClick={() => setUploadProgress([])} size="small">
              <Close />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent sx={{ 
          width: '100%',
          overflow: 'hidden',
          padding: { xs: 1, sm: 3 }
        }}>
          {uploadProgress.map((item, index) => (
            <Box key={index} sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'grey.200', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {item.fileName}
                  </Typography>
                  {item.isCamera && (
                    <Typography variant="caption" color="primary.main">
                      📷 Camera Photo {item.file && `(${(item.file.size / 1024 / 1024).toFixed(1)}MB)`}
                    </Typography>
                  )}
                </Box>
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {item.status === 'waiting' && (
                    <Typography variant="caption" color="text.secondary">⏳ Waiting</Typography>
                  )}
                  {item.status === 'compressing' && (
                    <Typography variant="caption" color="warning.main">🗜️ Compressing</Typography>
                  )}
                  {(item.status === 'uploading' || item.status === 'compressing') && (
                    <Typography variant="caption" color="primary.main">
                      {Math.round(item.progress)}%
                    </Typography>
                  )}
                  {item.status === 'completed' && (
                    <CheckCircle sx={{ color: 'success.main', fontSize: 20 }} />
                  )}
                  {item.status === 'error' && (
                    <>
                      <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
                      {item.canRetry && (
                        <IconButton
                          size="small"
                          onClick={() => retryUpload(index)}
                          sx={{ color: 'primary.main' }}
                          title="Retry upload"
                        >
                          <Refresh fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => removeFromQueue(index)}
                        sx={{ color: 'error.main' }}
                        title="Remove from queue"
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </>
                  )}
                </Box>
              </Box>
              
              <LinearProgress
                variant="determinate"
                value={item.progress}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: item.status === 'error' ? 'error.main' : 
                           item.status === 'completed' ? 'success.main' :
                           item.status === 'compressing' ? 'warning.main' : 'primary.main'
                  }
                }}
              />
              
              {item.error && (
                <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                  {item.error}
                </Typography>
              )}
            </Box>
          ))}
          
          {uploadProgress.length > 0 && !uploading && (
            <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                💡 Upload Tips:
              </Typography>
              <Typography variant="caption" display="block">
                • Camera photos are automatically compressed for faster upload
              </Typography>
              <Typography variant="caption" display="block">
                • Files upload one at a time for maximum reliability
              </Typography>
              <Typography variant="caption" display="block">
                • Click retry (🔄) for failed uploads
              </Typography>
              <Typography variant="caption" display="block">
                • Screenshots upload faster than camera photos
              </Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* QR Code Full Screen Dialog */}
      <Dialog 
        open={showQRDialog} 
        onClose={() => setShowQRDialog(false)}
        fullScreen={isMobile}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none'
          }
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${theme.palette.divider}`
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <QrCode sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Event QR Code</Typography>
          </Box>
          <IconButton onClick={() => setShowQRDialog(false)}>
            <Close />
          </IconButton>
        </DialogTitle>
        
        <DialogContent sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" gutterBottom color="primary">
            Share Your Event Gallery
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Guests can scan this QR code or click the link to access the gallery
          </Typography>
          
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            mb: 3,
            p: 2,
            bgcolor: 'white',
            borderRadius: 2,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: theme.shadows[2]
          }}>
            <canvas 
              ref={qrCanvasRef}
              style={{ 
                maxWidth: '100%',
                height: 'auto'
              }} 
            />
          </Box>

          <Typography 
            variant="body2" 
            color="primary"
            sx={{ 
              wordBreak: 'break-all',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              p: 2,
              borderRadius: 1,
              fontFamily: 'monospace',
              cursor: 'pointer',
              textDecoration: 'underline',
              mb: 3,
              '&:hover': {
                bgcolor: alpha(theme.palette.primary.main, 0.2),
              }
            }}
            onClick={() => window.open(eventUrl, '_blank')}
          >
            {eventUrl}
          </Typography>

          {copySuccess && (
            <Typography variant="body2" color="success.main" sx={{ mb: 2 }}>
              ✅ Link copied to clipboard!
            </Typography>
          )}
        </DialogContent>

        <DialogActions sx={{ 
          p: 3, 
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'center', 
          gap: isMobile ? 1 : 2,
          '& .MuiButton-root': {
            width: isMobile ? '100%' : 'auto',
            minWidth: isMobile ? 'auto' : 130
          }
        }}>
          {/* Primary action first on mobile */}
          <Button 
            onClick={() => window.open(eventUrl, '_blank')} 
            variant="contained"
            sx={{ 
              order: isMobile ? 1 : 4,
              minHeight: 48 
            }}
          >
            Visit Gallery
          </Button>
          
          {/* Print QR Code button */}
          <Button 
            onClick={async () => {
              try {
                // Validate canvas exists and has content
                if (!qrCanvasRef.current) {
                  throw new Error('QR code not ready. Please wait a moment and try again.');
                }
                
                // Check if canvas has actual content
                if (qrCanvasRef.current.width === 0 || qrCanvasRef.current.height === 0) {
                  throw new Error('QR code still loading. Please wait a moment and try again.');
                }
                
                // Generate data URL with error checking
                const qrDataUrl = qrCanvasRef.current.toDataURL('image/png');
                if (!qrDataUrl || qrDataUrl === 'data:,' || qrDataUrl.length < 100) {
                  throw new Error('Failed to generate QR code image. Please try again.');
                }
                
                // Create print window with popup blocker detection
                const printWindow = window.open('', '_blank', 'width=800,height=600');
                if (!printWindow) {
                  throw new Error('Print window was blocked. Please allow popups and try again.');
                }
                
                const eventTitle = document.title || 'Event Gallery';
                
                // Enhanced HTML with better error handling
                const printHTML = `
                  <!DOCTYPE html>
                  <html>
                    <head>
                      <title>Event QR Code - ${eventTitle}</title>
                      <meta charset="utf-8">
                      <style>
                        @media print {
                          * { box-sizing: border-box; }
                          body { 
                            margin: 0; 
                            padding: 20px; 
                            font-family: Arial, sans-serif;
                            line-height: 1.4;
                          }
                          .print-container { 
                            text-align: center; 
                            max-width: 400px; 
                            margin: 0 auto; 
                          }
                          .qr-image { 
                            width: 200px; 
                            height: 200px; 
                            margin: 20px auto; 
                            border: 2px solid #000; 
                            display: block;
                          }
                          .title { 
                            font-size: 24px; 
                            font-weight: bold; 
                            margin-bottom: 10px; 
                            color: #000;
                          }
                          .subtitle { 
                            font-size: 16px; 
                            color: #666; 
                            margin-bottom: 20px; 
                          }
                          .url { 
                            font-size: 12px; 
                            word-break: break-all; 
                            background: #f5f5f5; 
                            padding: 10px; 
                            border-radius: 5px; 
                            margin: 20px 0;
                            border: 1px solid #ddd;
                          }
                          .instructions { 
                            font-size: 14px; 
                            color: #333; 
                            margin-top: 20px; 
                            text-align: left; 
                          }
                          .instructions ol { 
                            padding-left: 20px; 
                            margin: 10px 0;
                          }
                          .instructions li { 
                            margin-bottom: 8px; 
                          }
                          .error-message {
                            color: #d32f2f;
                            font-weight: bold;
                            margin: 20px 0;
                          }
                        }
                        @media screen {
                          body { 
                            background: #f0f0f0; 
                            padding: 40px; 
                            min-height: 100vh;
                          }
                          .print-container { 
                            background: white; 
                            padding: 40px; 
                            border-radius: 10px; 
                            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                            margin: 0 auto;
                          }
                          .print-btn {
                            background: #1976d2;
                            color: white;
                            border: none;
                            padding: 12px 24px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 16px;
                            margin: 20px 10px;
                          }
                          .print-btn:hover {
                            background: #1565c0;
                          }
                        }
                      </style>
                    </head>
                    <body>
                      <div class="print-container">
                        <div class="title">Event Photo Gallery</div>
                        <div class="subtitle">Scan QR Code to Access Photos</div>
                        <img src="${qrDataUrl}" alt="QR Code" class="qr-image" onerror="document.querySelector('.error-message').style.display='block'" />
                        <div class="error-message" style="display:none;">
                          QR Code failed to load. Please close this window and try again.
                        </div>
                        <div class="url">${eventUrl}</div>
                        <div class="instructions">
                          <strong>Instructions for Guests:</strong>
                          <ol>
                            <li>Open your phone's camera app</li>
                            <li>Point the camera at this QR code</li>
                            <li>Tap the notification that appears</li>
                            <li>You'll be taken directly to the photo gallery</li>
                            <li>Or manually type the URL above into your browser</li>
                          </ol>
                          <p><strong>Share your photos:</strong> Upload photos directly from your phone to share with everyone!</p>
                        </div>
                        <div style="margin-top: 30px; display: none;" class="screen-only">
                          <button class="print-btn" onclick="window.print()">🖨️ Print QR Code</button>
                          <button class="print-btn" onclick="window.close()">✕ Close</button>
                        </div>
                      </div>
                      <script>
                        // Show print buttons on screen
                        document.querySelector('.screen-only').style.display = 'block';
                        
                        // Wait for image to load, then auto-print
                        const img = document.querySelector('.qr-image');
                        if (img.complete) {
                          setTimeout(() => window.print(), 100);
                        } else {
                          img.onload = () => {
                            setTimeout(() => window.print(), 100);
                          };
                          img.onerror = () => {
                            console.error('QR Code image failed to load');
                          };
                        }
                      </script>
                    </body>
                  </html>
                `;
                
                printWindow.document.write(printHTML);
                printWindow.document.close();
                
              } catch (error) {
                console.error('Print QR error:', error);
                
                // Enhanced fallback options
                const errorMessage = error instanceof Error ? error.message : 'Unknown print error';
                
                if (window.confirm(`Print Error: ${errorMessage}\n\nWould you like to download the QR code instead?`)) {
                  // Fallback to download
                  if (qrCanvasRef.current) {
                    const link = document.createElement('a');
                    link.download = 'event-qr-code.png';
                    link.href = qrCanvasRef.current.toDataURL('image/png');
                    link.click();
                  }
                }
              }
            }}
            variant="outlined"
            startIcon={<Print />}
            sx={{ 
              order: isMobile ? 2 : 1,
              minHeight: 48 
            }}
          >
            Print QR Code
          </Button>
          
          <Button 
            onClick={downloadQR} 
            variant="outlined"
            startIcon={<Download />}
            sx={{ 
              order: isMobile ? 3 : 2,
              minHeight: 48 
            }}
          >
            Download QR
          </Button>
          
          <Button 
            onClick={copyQRLink} 
            variant="outlined"
            startIcon={<ContentCopy />}
            sx={{ 
              order: isMobile ? 4 : 3,
              minHeight: 48 
            }}
          >
            Copy Link
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upgrade Modal for Freemium Limits */}
      {event && (
        <UpgradeModal
          open={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
          eventId={eventId}
          currentPhotoCount={event.photoCount || 0}
          onUpgradeSuccess={async () => {
            setShowUpgradeModal(false);
            console.log('🔄 BottomNavbar: Upgrade successful, refreshing event data...');
            
            try {
              // Wait a moment for server to process upgrade
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Force refresh event data
              const updatedEvent = await getEvent(eventId);
              if (updatedEvent) {
                setEvent(updatedEvent);
                console.log('✅ BottomNavbar: Event data refreshed:', updatedEvent.planType, updatedEvent.photoLimit);
              } else {
                console.warn('⚠️ BottomNavbar: Failed to get updated event data');
              }
            } catch (error) {
              console.error('❌ BottomNavbar: Error refreshing event data:', error);
              // Fallback: reload the page to ensure fresh data
              window.location.reload();
            }
          }}
        />
      )}
    </>
  );
};

export default BottomNavbar;
