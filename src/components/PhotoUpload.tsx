import React, { useState, useCallback } from 'react';
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
  alpha
} from '@mui/material';
import {
  CloudUpload,
  PhotoCamera,
  CheckCircle,
  Error as ErrorIcon,
  Add
} from '@mui/icons-material';
import { uploadPhoto } from '../services/photoService';
import { UploadProgress } from '../types';

interface PhotoUploadProps {
  weddingId: string;
  onUploadComplete?: () => void;
}

const PhotoUpload: React.FC<PhotoUploadProps> = ({ weddingId, onUploadComplete }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const theme = useTheme();

  // Utility function to compress images for mobile
  const compressImage = useCallback(async (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions (max 1920x1080 for mobile)
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
        
        // Draw and compress
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              console.log(`📷 Image compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.85 // 85% quality
        );
      };
      
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (files: FileList) => {
    console.log('📤 Files selected:', files.length);
    
    // Enhanced mobile detection
    const userAgent = navigator.userAgent;
    const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(userAgent);
    
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

    console.log('📤 Starting uploads...');

    // Initialize progress tracking
    const initialProgress: UploadProgress[] = imageFiles.map(file => ({
      fileName: file.name,
      progress: 0,
      status: 'uploading'
    }));
    setUploadProgress(initialProgress);

    // Process files (compress large mobile images)
    const processedFiles: File[] = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const sizeMB = file.size / 1024 / 1024;
      
      // Auto-compress large images on mobile
      if (isMobile && sizeMB > 8) {
        console.log(`📱 Large mobile image detected (${sizeMB.toFixed(2)}MB), compressing...`);
        setUploadProgress(prev => 
          prev.map((item, index) => 
            index === i ? { 
              ...item, 
              progress: 10,
              error: 'Compressing large image for mobile...',
              status: 'uploading'
            } : item
          )
        );
        
        try {
          const compressedFile = await compressImage(file);
          processedFiles.push(compressedFile);
        } catch (error) {
          console.error('Compression failed, using original:', error);
          processedFiles.push(file);
        }
      } else {
        processedFiles.push(file);
      }
    }

    // Upload files one at a time for better reliability
    for (let index = 0; index < processedFiles.length; index++) {
      const file = processedFiles[index];
      
      try {
        console.log(`Starting upload ${index + 1}/${processedFiles.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        
        // Check file size
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
          throw new Error(`File ${file.name} is too large (max 50MB)`);
        }

        // Enhanced retry logic for mobile
        let uploadSuccess = false;
        let retryCount = 0;
        const maxRetries = isMobile ? 2 : 3; // Fewer retries on mobile
        let lastError: any = null;
        
        while (!uploadSuccess && retryCount < maxRetries) {
          try {
            if (retryCount > 0) {
              console.log(`📱 Retry attempt ${retryCount}/${maxRetries} for ${file.name}`);
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
              
              // Longer delay for mobile retries
              const delay = isMobile ? (retryCount * 2000) : (retryCount * 1000);
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
        
        // Longer delay between uploads on mobile for stability
        if (index < processedFiles.length - 1) {
          const delay = isMobile ? 2000 : 1000;
          await new Promise<void>(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        console.error(`❌ Final failure for ${file.name}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        
        setUploadProgress(prev => 
          prev.map((item, i) => 
            i === index ? { 
              ...item, 
              status: 'error' as const,
              progress: 0,
              error: errorMessage
            } : item
          )
        );
      }
    }
    
    // Clear progress after delay
    setTimeout(() => {
      setUploadProgress([]);
      onUploadComplete?.();
    }, 5000); // Longer display time for mobile users to read results
  }, [weddingId, onUploadComplete, compressImage]);

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

        <input
          id="photo-upload-input"
          type="file"
          multiple
          accept="image/*,image/heic,image/heif"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
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
      </Paper>

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
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                    📱 Mobile Upload Tips:
                  </Typography>
                  <Typography variant="caption" component="div">
                    • Try reducing photo quality in camera settings
                  </Typography>
                  <Typography variant="caption" component="div">
                    • Use WiFi instead of cellular for large photos
                  </Typography>
                  <Typography variant="caption" component="div">
                    • Upload one photo at a time if multiple fail
                  </Typography>
                  <Typography variant="caption" component="div">
                    • Check your internet connection
                  </Typography>
                </Box>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default PhotoUpload;
