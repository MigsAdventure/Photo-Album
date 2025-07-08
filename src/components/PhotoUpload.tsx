import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  LinearProgress,
  Alert,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  useTheme,
  alpha,
  Chip,
  Snackbar
} from '@mui/material';
import {
  CloudUpload,
  PhotoCamera,
  CheckCircle,
  Error as ErrorIcon,
  Add,
  Sync,
  CloudQueue,
  Compress
} from '@mui/icons-material';
import { uploadPhoto } from '../services/photoService';
import { UploadProgress } from '../types';
import pwaService, { ImageCompressionService, QueueStatus } from '../services/pwaService';

interface PhotoUploadProps {
  weddingId: string;
  onUploadComplete?: () => void;
}

const PhotoUpload: React.FC<PhotoUploadProps> = ({ weddingId, onUploadComplete }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [showPWAInfo, setShowPWAInfo] = useState(false);
  const theme = useTheme();

  // Monitor upload queue status
  useEffect(() => {
    const updateQueueStatus = async () => {
      if (pwaService.isServiceWorkerSupported()) {
        const status = await pwaService.getQueueStatus();
        setQueueStatus(status);
      }
    };

    updateQueueStatus();
    const interval = setInterval(updateQueueStatus, 2000);

    // Listen for service worker events
    const handleUploadQueued = (data: any) => {
      console.log('📝 Upload queued:', data);
      setShowPWAInfo(true);
    };

    const handleUploadCompleted = (data: any) => {
      console.log('✅ Background upload completed:', data);
      onUploadComplete?.();
    };

    const handleUploadFailed = (data: any) => {
      console.error('❌ Background upload failed:', data);
    };

    if (pwaService.isServiceWorkerSupported()) {
      pwaService.on('UPLOAD_QUEUED', handleUploadQueued);
      pwaService.on('UPLOAD_COMPLETED', handleUploadCompleted);
      pwaService.on('UPLOAD_FAILED', handleUploadFailed);
    }

    return () => {
      clearInterval(interval);
      if (pwaService.isServiceWorkerSupported()) {
        pwaService.off('UPLOAD_QUEUED', handleUploadQueued);
        pwaService.off('UPLOAD_COMPLETED', handleUploadCompleted);
        pwaService.off('UPLOAD_FAILED', handleUploadFailed);
      }
    };
  }, [onUploadComplete]);

  const handleFileSelect = useCallback(async (files: FileList) => {
    console.log('🎉 Professional Upload System: Files selected:', files.length);
    
    const imageFiles = Array.from(files).filter(file => {
      console.log('File details:', {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified
      });
      return file.type.startsWith('image/') || file.type === '' || 
             file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|heic|heif)$/);
    });

    if (imageFiles.length === 0) {
      alert('Please select valid image files');
      return;
    }

    console.log('🚀 Processing image files with professional compression...');
    setProcessingFiles(true);

    try {
      // Step 1: Smart image processing with compression
      const processedFiles = await ImageCompressionService.processBatch(
        imageFiles,
        (current, total) => {
          console.log(`📸 Processing image ${current}/${total}`);
        }
      );

      console.log('✅ Image processing complete, starting uploads...');

      // Initialize progress tracking
      const initialProgress: UploadProgress[] = processedFiles.map(file => ({
        fileName: file.name,
        progress: 0,
        status: 'uploading'
      }));
      setUploadProgress(initialProgress);

      // Step 2: Try PWA background uploads first (most reliable)
      if (pwaService.isServiceWorkerSupported() && processedFiles.length > 5) {
        console.log('🔄 Using PWA background upload for batch of', processedFiles.length, 'files');
        
        try {
          // Queue all files for background upload
          for (const file of processedFiles) {
            await pwaService.queueUpload(file, weddingId);
          }
          
          setUploadProgress([]);
          setProcessingFiles(false);
          setShowPWAInfo(true);
          
          return; // PWA will handle the rest
          
        } catch (pwaError) {
          console.warn('⚠️ PWA upload failed, falling back to direct upload:', pwaError);
        }
      }

      // Step 3: Fallback to direct upload (enhanced reliability)
      console.log('📤 Using direct upload with enhanced reliability...');
      
      for (let index = 0; index < processedFiles.length; index++) {
        const file = processedFiles[index];
        
        try {
          console.log(`Starting upload ${index + 1}/${processedFiles.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
          
          // Check file size
          const maxSize = 50 * 1024 * 1024; // 50MB
          if (file.size > maxSize) {
            throw new Error(`File ${file.name} is too large (max 50MB)`);
          }

          // Enhanced retry logic
          let uploadSuccess = false;
          let retryCount = 0;
          const maxRetries = 3; // Reduced since we have compression now
          let lastError: any = null;
          
          while (!uploadSuccess && retryCount < maxRetries) {
            try {
              if (retryCount > 0) {
                console.log(`Retry attempt ${retryCount}/${maxRetries} for ${file.name}`);
                setUploadProgress(prev => 
                  prev.map((item, i) => 
                    i === index ? { 
                      ...item, 
                      progress: 0,
                      error: `Retrying... (${retryCount}/${maxRetries})`,
                      status: 'uploading'
                    } : item
                  )
                );
                
                const delay = retryCount * 1000;
                await new Promise<void>(resolve => setTimeout(resolve, delay));
              }
              
              await uploadPhoto(file, weddingId, (progress) => {
                setUploadProgress(prev => 
                  prev.map((item, i) => 
                    i === index ? { 
                      ...item, 
                      progress,
                      error: undefined,
                      status: 'uploading'
                    } : item
                  )
                );
              });
              
              uploadSuccess = true;
              console.log(`✅ Upload successful for ${file.name} after ${retryCount + 1} attempts`);
              
            } catch (error) {
              lastError = error;
              retryCount++;
              console.error(`❌ Upload attempt ${retryCount}/${maxRetries} failed for ${file.name}:`, error);
              
              if (retryCount >= maxRetries) {
                throw lastError;
              }
            }
          }

          setUploadProgress(prev => 
            prev.map((item, i) => 
              i === index ? { ...item, status: 'completed', progress: 100 } : item
            )
          );
          
          // Small delay between uploads for stability
          if (index < processedFiles.length - 1) {
            await new Promise<void>(resolve => setTimeout(resolve, 800));
          }
          
        } catch (error) {
          console.error(`❌ Final failure for ${file.name}:`, error);
          setUploadProgress(prev => 
            prev.map((item, i) => 
              i === index ? { 
                ...item, 
                status: 'error' as const,
                progress: 0,
                error: error instanceof Error ? error.message : 'Upload failed'
              } : item
            )
          );
        }
      }
      
    } catch (error) {
      console.error('❌ Upload process failed:', error);
    } finally {
      setProcessingFiles(false);
      
      // Clear progress after delay
      setTimeout(() => {
        setUploadProgress([]);
        onUploadComplete?.();
      }, 3000);
    }
  }, [weddingId, onUploadComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  const handleButtonClick = () => {
    const fileInput = document.getElementById('photo-upload-input') as HTMLInputElement;
    fileInput?.click();
  };

  return (
    <Box sx={{ mb: 4 }}>
      <Paper
        elevation={isDragging ? 4 : 1}
        sx={{
          p: 4,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          border: `2px dashed ${isDragging ? theme.palette.primary.main : theme.palette.grey[300]}`,
          bgcolor: isDragging ? alpha(theme.palette.primary.main, 0.05) : 'background.paper',
          '&:hover': {
            bgcolor: alpha(theme.palette.primary.main, 0.02),
            borderColor: theme.palette.primary.light,
          }
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleButtonClick}
      >
        <PhotoCamera 
          sx={{ 
            fontSize: 60, 
            color: isDragging ? 'primary.main' : 'grey.400',
            mb: 2,
            transition: 'color 0.3s ease'
          }} 
        />
        
        <Typography variant="h5" gutterBottom color="primary">
          Upload Photos
        </Typography>
        
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Drag and drop photos here, or click to select from your device
        </Typography>

        {/* Hidden file inputs for different scenarios */}
        <input
          id="photo-gallery-input"
          type="file"
          multiple
          accept="image/*,image/heic,image/heif"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />
        
        <input
          id="photo-camera-input"
          type="file"
          accept="image/*,image/heic,image/heif"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          capture="environment"
        />

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, justifyContent: 'center' }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<PhotoCamera />}
            sx={{ px: 4, py: 1.5 }}
            onClick={(e) => {
              e.stopPropagation();
              const cameraInput = document.getElementById('photo-camera-input') as HTMLInputElement;
              cameraInput?.click();
            }}
          >
            Take Photo
          </Button>
          
          <Button
            variant="outlined"
            size="large"
            startIcon={<Add />}
            sx={{ px: 4, py: 1.5 }}
            onClick={(e) => {
              e.stopPropagation();
              const galleryInput = document.getElementById('photo-gallery-input') as HTMLInputElement;
              galleryInput?.click();
            }}
          >
            Choose from Gallery
          </Button>
        </Box>

        <Typography variant="caption" display="block" sx={{ mt: 2, color: 'text.secondary' }}>
          Supports: JPG, PNG, HEIC and other image formats (max 50MB per photo)
        </Typography>
        
        {/* PWA Status Indicator */}
        {pwaService.isServiceWorkerSupported() && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Chip 
              icon={<CloudQueue />} 
              label="Professional Background Upload Ready" 
              size="small" 
              color="primary" 
              variant="outlined"
            />
          </Box>
        )}
      </Paper>

      {/* Processing Status */}
      {processingFiles && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Compress sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6" color="primary">
                Processing Images...
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Optimizing images for faster, more reliable uploads while maintaining quality
            </Typography>
            <LinearProgress sx={{ mt: 2 }} />
          </CardContent>
        </Card>
      )}

      {/* PWA Background Upload Status */}
      {queueStatus && queueStatus.total > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Sync sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6" color="primary">
                Background Upload Queue
              </Typography>
            </Box>
            
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {queueStatus.uploading > 0 && (
                <Chip 
                  label={`${queueStatus.uploading} Uploading`} 
                  color="primary" 
                  size="small" 
                />
              )}
              {queueStatus.queued > 0 && (
                <Chip 
                  label={`${queueStatus.queued} Queued`} 
                  color="default" 
                  size="small" 
                />
              )}
              {queueStatus.completed > 0 && (
                <Chip 
                  label={`${queueStatus.completed} Completed`} 
                  color="success" 
                  size="small" 
                />
              )}
              {queueStatus.retrying > 0 && (
                <Chip 
                  label={`${queueStatus.retrying} Retrying`} 
                  color="warning" 
                  size="small" 
                />
              )}
              {queueStatus.failed > 0 && (
                <Chip 
                  label={`${queueStatus.failed} Failed`} 
                  color="error" 
                  size="small" 
                />
              )}
            </Box>
            
            <Typography variant="body2" color="text.secondary">
              Photos are uploading in the background. You can close this browser tab and uploads will continue.
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* PWA Information Snackbar */}
      <Snackbar
        open={showPWAInfo}
        autoHideDuration={6000}
        onClose={() => setShowPWAInfo(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setShowPWAInfo(false)} 
          severity="success" 
          sx={{ width: '100%' }}
        >
          Photos queued for reliable background upload! You can close the browser - uploads will continue.
        </Alert>
      </Snackbar>

      {uploadProgress.length > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CloudUpload sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6" color="primary">
                Uploading Photos...
              </Typography>
            </Box>
            
            <List dense>
              {uploadProgress.map((item, index) => (
                <ListItem key={index} sx={{ px: 0 }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Typography variant="body2" sx={{ flexGrow: 1 }}>
                          {item.fileName}
                        </Typography>
                        <Box sx={{ ml: 2 }}>
                          {item.status === 'uploading' && (
                            <Typography variant="caption" color="primary">
                              {Math.round(item.progress)}%
                            </Typography>
                          )}
                          {item.status === 'completed' && (
                            <CheckCircle sx={{ color: 'success.main', fontSize: 20 }} />
                          )}
                          {item.status === 'error' && (
                            <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
                          )}
                        </Box>
                      </Box>
                    }
                    secondary={
                      <LinearProgress
                        variant="determinate"
                        value={item.progress}
                        sx={{
                          height: 4,
                          borderRadius: 2,
                          bgcolor: 'grey.200',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: item.status === 'error' ? 'error.main' : 
                                   item.status === 'completed' ? 'success.main' : 'primary.main'
                          }
                        }}
                      />
                    }
                  />
                </ListItem>
              ))}
            </List>

            {uploadProgress.every(item => item.status === 'completed') && (
              <Alert severity="success" sx={{ mt: 2 }}>
                All photos uploaded successfully! They will appear in the gallery momentarily.
              </Alert>
            )}

            {uploadProgress.some(item => item.status === 'error') && (
              <Alert severity="error" sx={{ mt: 2 }}>
                <Typography variant="body2" component="div">
                  Upload errors:
                </Typography>
                {uploadProgress
                  .filter(item => item.status === 'error')
                  .map((item, idx) => (
                    <Typography key={idx} variant="caption" component="div" sx={{ mt: 0.5 }}>
                      • {item.fileName}: {item.error || 'Upload failed'}
                    </Typography>
                  ))}
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Please try again. For mobile users: try taking smaller photos or using "Choose from Gallery" instead.
                </Typography>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default PhotoUpload;
