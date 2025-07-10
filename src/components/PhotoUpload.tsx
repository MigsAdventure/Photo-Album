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
  alpha,
  IconButton,
  Chip,
  Stack
} from '@mui/material';
import {
  CloudUpload,
  PhotoCamera,
  CheckCircle,
  Error as ErrorIcon,
  Add,
  Refresh,
  Delete
} from '@mui/icons-material';
import { uploadPhoto } from '../services/photoService';
import { UploadProgress, FileAnalysis } from '../types';

interface PhotoUploadProps {
  eventId: string;
  onUploadComplete?: () => void;
}

const PhotoUpload: React.FC<PhotoUploadProps> = ({ eventId, onUploadComplete }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadProgress[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [currentUploadIndex, setCurrentUploadIndex] = useState(-1);
  const theme = useTheme();

  // Analyze file to determine if it's a camera photo vs screenshot
  const analyzeFile = useCallback((file: File): FileAnalysis => {
    const sizeMB = file.size / 1024 / 1024;
    
    // Heuristics to detect camera photos vs screenshots
    const isCamera = (
      sizeMB > 3 || // Camera photos are usually >3MB
      file.name.toLowerCase().includes('img_') || // iOS camera naming
      file.name.toLowerCase().includes('dsc') || // Camera naming
      (file.type === 'image/jpeg' && sizeMB > 1.5) // Large JPEG likely camera
    );
    
    const isScreenshot = (
      file.name.toLowerCase().includes('screenshot') ||
      file.name.toLowerCase().includes('screen') ||
      file.type === 'image/png' ||
      sizeMB < 2
    );
    
    const needsCompression = isCamera && sizeMB > 8;
    
    return {
      isCamera,
      isScreenshot,
      needsCompression,
      originalSize: file.size,
      estimatedCompressedSize: needsCompression ? file.size * 0.3 : file.size
    };
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

  // Sequential upload processing
  const processUploadQueue = useCallback(async () => {
    if (isUploading || uploadQueue.length === 0) return;
    
    setIsUploading(true);
    
    for (let i = 0; i < uploadQueue.length; i++) {
      const item = uploadQueue[i];
      
      // Skip completed or errored items (unless retrying)
      if (item.status === 'completed') continue;
      
      setCurrentUploadIndex(i);
      
      try {
        // Update status to show this file is active
        setUploadQueue(prev => 
          prev.map((q, idx) => 
            idx === i ? { ...q, status: 'uploading', progress: 0, error: undefined } : q
          )
        );

        let fileToUpload = item.file!;
        
        // Compress if needed
        if (item.isCamera && item.file!.size > 8 * 1024 * 1024) {
          setUploadQueue(prev => 
            prev.map((q, idx) => 
              idx === i ? { ...q, status: 'compressing', progress: 20 } : q
            )
          );
          
          fileToUpload = await compressImage(item.file!);
          
          setUploadQueue(prev => 
            prev.map((q, idx) => 
              idx === i ? { ...q, status: 'uploading', progress: 30 } : q
            )
          );
        }

        // Upload the file
        await uploadPhoto(fileToUpload, eventId, (progress) => {
          setUploadQueue(prev => 
            prev.map((q, idx) => 
              idx === i ? { ...q, progress: Math.max(progress, 30) } : q
            )
          );
        });
        
        // Mark as completed
        setUploadQueue(prev => 
          prev.map((q, idx) => 
            idx === i ? { ...q, status: 'completed', progress: 100 } : q
          )
        );
        
        // DEBUG: Breakpoint for horizontal scrolling investigation
        debugger; // REMOVE THIS AFTER FIXING HORIZONTAL SCROLL
        
        console.log(`✅ Upload ${i + 1}/${uploadQueue.length} completed: ${item.fileName}`);
        
        // Delay between uploads for stability
        if (i < uploadQueue.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ Upload ${i + 1}/${uploadQueue.length} failed:`, error);
        
        setUploadQueue(prev => 
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
    
    setIsUploading(false);
    setCurrentUploadIndex(-1);
    
    // Check if all completed
    const allCompleted = uploadQueue.every(item => item.status === 'completed');
    if (allCompleted) {
      setTimeout(() => {
        setUploadQueue([]);
        onUploadComplete?.();
      }, 3000);
    }
  }, [uploadQueue, isUploading, eventId, onUploadComplete, compressImage]);

  const handleFileSelect = useCallback(async (files: FileList) => {
    console.log('📤 Files selected:', files.length);
    
    const imageFiles = Array.from(files).filter(file => {
      return file.type.startsWith('image/') || file.type === '' || 
             file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|heic|heif)$/);
    });

    if (imageFiles.length === 0) {
      alert('Please select valid image files');
      return;
    }

    // Analyze and create upload queue
    const newQueue: UploadProgress[] = imageFiles.map((file, index) => {
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

    setUploadQueue(newQueue);
    
    // Start processing
    setTimeout(() => processUploadQueue(), 100);
  }, [analyzeFile, processUploadQueue]);

  const retryUpload = useCallback((fileIndex: number) => {
    setUploadQueue(prev => 
      prev.map((item, idx) => 
        idx === fileIndex ? { 
          ...item, 
          status: 'waiting',
          progress: 0,
          error: undefined,
          canRetry: false
        } : item
      )
    );
    
    // Restart processing
    if (!isUploading) {
      setTimeout(() => processUploadQueue(), 100);
    }
  }, [isUploading, processUploadQueue]);

  const removeFromQueue = useCallback((fileIndex: number) => {
    setUploadQueue(prev => prev.filter((_, idx) => idx !== fileIndex));
  }, []);

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
    <Box sx={{ 
      mb: 4,
      width: '100%',
      overflow: 'hidden',
      maxWidth: '100vw'
    }}>
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

        {/* Hidden file inputs */}
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

        <Stack 
          direction={{ xs: 'column', sm: 'row' }} 
          spacing={2} 
          sx={{ 
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%',
            maxWidth: '100%',
            overflow: 'hidden'
          }}
        >
          <Button
            variant="contained"
            size="large"
            startIcon={<PhotoCamera />}
            sx={{ 
              px: { xs: 2, sm: 3 }, 
              py: 1.5,
              width: { xs: '100%', sm: 'auto' },
              maxWidth: { xs: '100%', sm: '200px' },
              fontSize: { xs: '0.9rem', sm: '1rem' },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
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
            sx={{ 
              px: { xs: 2, sm: 3 }, 
              py: 1.5,
              width: { xs: '100%', sm: 'auto' },
              maxWidth: { xs: '100%', sm: '200px' },
              fontSize: { xs: '0.9rem', sm: '1rem' },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
            onClick={(e) => {
              e.stopPropagation();
              const galleryInput = document.getElementById('photo-gallery-input') as HTMLInputElement;
              galleryInput?.click();
            }}
          >
            Choose from Gallery
          </Button>
        </Stack>

        <Typography variant="caption" display="block" sx={{ mt: 2, color: 'text.secondary' }}>
          📱 Camera photos are automatically optimized for mobile upload (max 50MB per photo)
        </Typography>
      </Paper>

      {uploadQueue.length > 0 && (
        <Card sx={{ 
          mt: 3,
          width: '100%',
          maxWidth: 'calc(100vw - 32px)',
          overflow: 'hidden',
          boxSizing: 'border-box'
        }}>
          <CardContent sx={{
            width: '100%',
            overflow: 'hidden',
            minWidth: 0,
            boxSizing: 'border-box',
            maxWidth: '100%'
          }}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              mb: 2, 
              justifyContent: 'space-between',
              flexWrap: { xs: 'wrap', sm: 'nowrap' },
              gap: 1
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flexShrink: 1 }}>
                <CloudUpload sx={{ mr: 1, color: 'primary.main', flexShrink: 0 }} />
                <Typography 
                  variant="h6" 
                  color="primary"
                  sx={{ 
                    fontSize: { xs: '1rem', sm: '1.25rem' },
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  Upload Queue ({uploadQueue.filter(q => q.status === 'completed').length}/{uploadQueue.length})
                </Typography>
              </Box>
              {isUploading && (
                <Typography 
                  variant="caption" 
                  color="text.secondary"
                  sx={{ 
                    whiteSpace: { xs: 'normal', sm: 'nowrap' },
                    fontSize: { xs: '0.7rem', sm: '0.75rem' },
                    textAlign: { xs: 'center', sm: 'right' },
                    width: { xs: '100%', sm: 'auto' }
                  }}
                >
                  Processing files one at a time...
                </Typography>
              )}
            </Box>
            
            <List dense sx={{ 
              width: '100%',
              overflow: 'hidden',
              minWidth: 0
            }}>
              {uploadQueue.map((item, index) => (
                <ListItem 
                  key={index} 
                  sx={{ 
                    px: 0, 
                    bgcolor: currentUploadIndex === index ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                    borderRadius: 1,
                    mb: 1,
                    display: 'table',
                    tableLayout: 'fixed',
                    width: '100%',
                    overflow: 'hidden'
                  }}
                >
                  <ListItemText
                    sx={{ 
                      display: 'table-cell',
                      width: '100%',
                      overflow: 'hidden'
                    }}
                    primary={
                      <Box sx={{ 
                        display: 'table',
                        tableLayout: 'fixed',
                        width: '100%',
                        overflow: 'hidden'
                      }}>
                        <Box sx={{ 
                          display: 'table-row',
                          width: '100%'
                        }}>
                          <Box sx={{ 
                            display: 'table-cell',
                            width: { xs: '100%', sm: 'calc(100% - 80px)' },
                            overflow: 'hidden',
                            pr: { xs: 0, sm: 1 }
                          }}>
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                fontWeight: currentUploadIndex === index ? 'bold' : 'normal',
                                fontSize: { xs: '0.8rem', sm: '0.875rem' },
                                wordBreak: 'break-all',
                                overflow: 'hidden',
                                display: 'block',
                                lineHeight: 1.2,
                                maxWidth: '100%'
                              }}
                              title={item.fileName}
                            >
                              {item.fileName}
                            </Typography>
                            <Stack 
                              direction="row" 
                              spacing={0.5} 
                              sx={{ 
                                mt: 0.5,
                                flexWrap: 'wrap',
                                gap: 0.5
                              }}
                            >
                              {item.isCamera && (
                                <Chip 
                                  label="📷 Camera" 
                                  size="small" 
                                  color="primary" 
                                  variant="outlined"
                                  sx={{ fontSize: '0.65rem', height: '20px' }}
                                />
                              )}
                              {item.status === 'compressing' && (
                                <Chip 
                                  label="🗜️ Compressing" 
                                  size="small" 
                                  color="warning"
                                  sx={{ fontSize: '0.65rem', height: '20px' }}
                                />
                              )}
                              {item.status === 'waiting' && (
                                <Chip 
                                  label="⏳ Waiting" 
                                  size="small" 
                                  variant="outlined"
                                  sx={{ fontSize: '0.65rem', height: '20px' }}
                                />
                              )}
                            </Stack>
                          </Box>
                          
                          <Box sx={{ 
                            display: 'table-cell',
                            width: { xs: '0px', sm: '80px' },
                            textAlign: 'right',
                            verticalAlign: 'top',
                            pl: { xs: 0, sm: 1 }
                          }}>
                            <Box sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              justifyContent: 'flex-end'
                            }}>
                              {item.status === 'uploading' || item.status === 'compressing' ? (
                                <Typography 
                                  variant="caption" 
                                  color="primary"
                                  sx={{ fontSize: '0.7rem', fontWeight: 'bold' }}
                                >
                                  {Math.round(item.progress)}%
                                </Typography>
                              ) : item.status === 'completed' ? (
                                <CheckCircle sx={{ color: 'success.main', fontSize: 18 }} />
                              ) : item.status === 'error' ? (
                                <>
                                  <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
                                  {item.canRetry && (
                                    <IconButton
                                      size="small"
                                      onClick={() => retryUpload(index)}
                                      sx={{ 
                                        color: 'primary.main',
                                        p: 0.25,
                                        minWidth: 'auto'
                                      }}
                                    >
                                      <Refresh fontSize="small" />
                                    </IconButton>
                                  )}
                                  <IconButton
                                    size="small"
                                    onClick={() => removeFromQueue(index)}
                                    sx={{ 
                                      color: 'error.main',
                                      p: 0.25,
                                      minWidth: 'auto'
                                    }}
                                  >
                                    <Delete fontSize="small" />
                                  </IconButton>
                                </>
                              ) : null}
                            </Box>
                          </Box>
                        </Box>
                      </Box>
                    }
                    secondary={
                      <Box>
                        <LinearProgress
                          variant="determinate"
                          value={item.progress}
                          sx={{
                            height: 4,
                            borderRadius: 2,
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
                    }
                  />
                </ListItem>
              ))}
            </List>

            {uploadQueue.every(item => item.status === 'completed') && (
              <Alert severity="success" sx={{ mt: 2 }}>
                🎉 All photos uploaded successfully! They will appear in the gallery momentarily.
              </Alert>
            )}

            {uploadQueue.some(item => item.status === 'error') && (
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2" component="div" sx={{ mb: 1 }}>
                  💡 Camera Photo Upload Tips:
                </Typography>
                <Typography variant="caption" component="div">
                  • Large camera photos are automatically compressed and optimized
                </Typography>
                <Typography variant="caption" component="div">
                  • Screenshots and smaller images upload faster than camera photos
                </Typography>
                <Typography variant="caption" component="div">
                  • Use the retry button (🔄) for failed uploads
                </Typography>
                <Typography variant="caption" component="div">
                  • Files upload one at a time for maximum reliability
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
