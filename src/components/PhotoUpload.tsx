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

  const handleFileSelect = useCallback(async (files: FileList) => {
    console.log('Files selected:', files.length);
    
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

    console.log('Processing image files:', imageFiles.map(f => ({ name: f.name, size: f.size, type: f.type })));

    // Initialize progress tracking
    const initialProgress: UploadProgress[] = imageFiles.map(file => ({
      fileName: file.name,
      progress: 0,
      status: 'uploading'
    }));
    setUploadProgress(initialProgress);

    // Upload files one at a time for mobile compatibility with enhanced error handling
    for (let index = 0; index < imageFiles.length; index++) {
      const file = imageFiles[index];
      
      try {
        console.log(`Starting upload ${index + 1}/${imageFiles.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        
        // Check file size (mobile photos can be very large)
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
          console.warn(`File ${file.name} is too large: ${file.size} bytes`);
          throw new Error(`File ${file.name} is too large (max 50MB)`);
        }

        // Enhanced retry logic for mobile uploads
        let uploadSuccess = false;
        let retryCount = 0;
        const maxRetries = 5; // Increased retries
        let lastError: any = null;
        
        while (!uploadSuccess && retryCount < maxRetries) {
          try {
            if (retryCount > 0) {
              console.log(`Retry attempt ${retryCount}/${maxRetries} for ${file.name}`);
              // Show retry message to user
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
              // Progressive delay: 1s, 2s, 3s, 4s
              const delay = Math.min(retryCount * 1000, 5000);
              await new Promise<void>(resolve => setTimeout(resolve, delay));
            }
            
            console.log(`Attempting upload for ${file.name} (attempt ${retryCount + 1})`);
            
            await uploadPhoto(file, weddingId, (progress) => {
              console.log(`Upload progress for ${file.name}: ${progress}%`);
              setUploadProgress(prev => 
                prev.map((item, i) => 
                  i === index ? { 
                    ...item, 
                    progress,
                    error: undefined, // Clear any retry messages
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
            
            // For the last retry, wait longer before giving up
            if (retryCount >= maxRetries) {
              console.error(`🚨 All ${maxRetries} attempts failed for ${file.name}`, lastError);
              throw lastError;
            }
          }
        }

        console.log(`Upload completed for ${file.name}`);
        setUploadProgress(prev => 
          prev.map((item, i) => 
            i === index ? { ...item, status: 'completed', progress: 100 } : item
          )
        );
        
        // Longer delay between uploads for mobile stability
        if (index < imageFiles.length - 1) {
          console.log(`Waiting before next upload...`);
          await new Promise<void>(resolve => setTimeout(resolve, 1500));
        }
        
      } catch (error) {
        console.error(`❌ Final failure for ${file.name}:`, error);
        setUploadProgress(prev => 
          prev.map((item, i) => 
            i === index ? { 
              ...item, 
              status: 'error' as const,
              progress: 0,
              error: error instanceof Error ? error.message : 'Upload failed after all retries'
            } : item
          )
        );
        
        // Continue with next file instead of stopping
        console.log(`Continuing to next file despite failure of ${file.name}`);
      }
    }
    
    // Clear progress after a delay
    setTimeout(() => {
      setUploadProgress([]);
      onUploadComplete?.();
    }, 3000);
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
