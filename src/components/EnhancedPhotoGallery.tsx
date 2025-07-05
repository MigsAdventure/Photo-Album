import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardMedia,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Chip,
  Skeleton,
  Container,
  useTheme,
  useMediaQuery,
  Fade,
  Zoom,
  Paper,
  alpha
} from '@mui/material';
import {
  Close,
  PhotoLibrary,
  AccessTime,
  FileDownload,
  ArrowBackIos,
  ArrowForwardIos
} from '@mui/icons-material';
import { useSwipeable } from 'react-swipeable';
import { subscribeToPhotos } from '../services/photoService';
import { Photo } from '../types';

interface EnhancedPhotoGalleryProps {
  eventId: string;
}

const EnhancedPhotoGallery: React.FC<EnhancedPhotoGalleryProps> = ({ eventId }) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [thumbnailsRef, setThumbnailsRef] = useState<HTMLElement | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    const unsubscribe = subscribeToPhotos(eventId, (newPhotos) => {
      setPhotos(newPhotos);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [eventId]);

  const openModal = (photoIndex: number) => {
    setSelectedPhotoIndex(photoIndex);
  };

  const closeModal = () => {
    setSelectedPhotoIndex(null);
  };

  const goToPrevious = useCallback(() => {
    if (selectedPhotoIndex !== null && selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    }
  }, [selectedPhotoIndex]);

  const goToNext = useCallback(() => {
    if (selectedPhotoIndex !== null && selectedPhotoIndex < photos.length - 1) {
      setSelectedPhotoIndex(selectedPhotoIndex + 1);
    }
  }, [selectedPhotoIndex, photos.length]);

  const goToPhoto = (index: number) => {
    setSelectedPhotoIndex(index);
    // Scroll thumbnail into view
    if (thumbnailsRef) {
      const thumbnail = thumbnailsRef.children[index] as HTMLElement;
      if (thumbnail) {
        thumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (selectedPhotoIndex === null) return;
      
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          goToPrevious();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goToNext();
          break;
        case 'Escape':
          event.preventDefault();
          closeModal();
          break;
      }
    };

    if (selectedPhotoIndex !== null) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [selectedPhotoIndex, goToPrevious, goToNext]);

  // Swipe handlers
  const swipeHandlers = useSwipeable({
    onSwipedLeft: goToNext,
    onSwipedRight: goToPrevious,
    trackMouse: true,
  });

  const formatDate = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const downloadPhoto = async (photo: Photo) => {
    try {
      // Create a link element with download attribute
      const link = document.createElement('a');
      link.href = photo.url;
      link.download = photo.fileName || `photo-${new Date().getTime()}.jpg`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      
      // For Firebase Storage URLs, we need to trigger the download differently
      // First try the standard approach
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // If that doesn't work due to CORS, the browser will open it in a new tab
      // which allows the user to save it manually
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback to opening in new tab
      window.open(photo.url + '&download=true', '_blank');
    }
  };

  const currentPhoto = selectedPhotoIndex !== null ? photos[selectedPhotoIndex] : null;

  if (loading) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mb: 3 }}>
          <Skeleton variant="text" width={200} height={40} />
          <Skeleton variant="text" width={100} height={24} />
        </Box>
        <Box 
          sx={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: 2
          }}
        >
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton 
              key={index}
              variant="rectangular" 
              height={200} 
              sx={{ borderRadius: 2 }} 
            />
          ))}
        </Box>
      </Container>
    );
  }

  if (photos.length === 0) {
    return (
      <Container maxWidth="sm">
        <Card 
          sx={{ 
            textAlign: 'center', 
            py: 8, 
            bgcolor: 'grey.50',
            border: '2px dashed',
            borderColor: 'grey.300'
          }}
        >
          <PhotoLibrary 
            sx={{ 
              fontSize: 80, 
              color: 'grey.400', 
              mb: 2 
            }} 
          />
          <Typography variant="h5" gutterBottom color="text.secondary">
            No photos yet
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Photos will appear here as guests upload them!
          </Typography>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <PhotoLibrary sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h4" color="primary" sx={{ flexGrow: 1 }}>
            Event Gallery
          </Typography>
          <Chip 
            label={`${photos.length} photo${photos.length !== 1 ? 's' : ''}`}
            color="primary"
            variant="outlined"
          />
        </Box>
        <Typography variant="body1" color="text.secondary">
          Live updates from your guests - photos appear as they're uploaded!
        </Typography>
      </Box>
      
      <Box 
        sx={{ 
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(4, 1fr)',
            lg: 'repeat(5, 1fr)'
          },
          gap: 2
        }}
      >
        {photos.map((photo, index) => (
          <Zoom in timeout={300 + index * 50} key={photo.id}>
            <Card 
              sx={{ 
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                position: 'relative',
                '&:hover': {
                  transform: 'scale(1.02)',
                  boxShadow: theme.shadows[8]
                }
              }}
              onClick={() => openModal(index)}
            >
              <CardMedia
                component="img"
                height={200}
                image={photo.url}
                alt={photo.fileName || 'Event photo'}
                sx={{ 
                  objectFit: 'cover',
                  transition: 'transform 0.3s ease',
                  '&:hover': {
                    transform: 'scale(1.05)'
                  }
                }}
              />
              <Box 
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                  color: 'white',
                  p: 1,
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <AccessTime sx={{ fontSize: 16, mr: 0.5 }} />
                <Typography variant="caption">
                  {formatDate(photo.uploadedAt)}
                </Typography>
              </Box>
            </Card>
          </Zoom>
        ))}
      </Box>

      {/* Android-Style Photo Viewer */}
      <Dialog
        open={selectedPhotoIndex !== null}
        onClose={closeModal}
        maxWidth={false}
        fullWidth
        fullScreen={isMobile}
        TransitionComponent={Fade}
        PaperProps={{
          sx: {
            bgcolor: 'black',
            maxWidth: '100vw',
            maxHeight: '100vh',
            m: 0
          }
        }}
      >
        {currentPhoto && (
          <Box sx={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <DialogTitle sx={{ 
              display: 'flex', 
              alignItems: 'center',
              bgcolor: alpha('#000000', 0.8),
              color: 'white',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 2,
              py: 1
            }}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {selectedPhotoIndex! + 1} of {photos.length}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {formatDate(currentPhoto.uploadedAt)}
                </Typography>
              </Box>
              <IconButton
                onClick={() => downloadPhoto(currentPhoto)}
                sx={{ mr: 1, color: 'white' }}
                title="Download"
              >
                <FileDownload />
              </IconButton>
              <IconButton onClick={closeModal} sx={{ color: 'white' }} title="Close">
                <Close />
              </IconButton>
            </DialogTitle>

            {/* Main Photo Display */}
            <DialogContent 
              sx={{ 
                p: 0, 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                position: 'relative',
                bgcolor: 'black'
              }}
              {...swipeHandlers}
            >
              {/* Previous Button */}
              {selectedPhotoIndex! > 0 && (
                <IconButton
                  onClick={goToPrevious}
                  sx={{
                    position: 'absolute',
                    left: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 2,
                    bgcolor: alpha('#000000', 0.5),
                    color: 'white',
                    '&:hover': {
                      bgcolor: alpha('#000000', 0.7),
                    }
                  }}
                >
                  <ArrowBackIos />
                </IconButton>
              )}

              {/* Photo */}
              <Box
                component="img"
                src={currentPhoto.url}
                alt={currentPhoto.fileName || 'Event photo'}
                sx={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  userSelect: 'none',
                  pointerEvents: 'none'
                }}
              />

              {/* Next Button */}
              {selectedPhotoIndex! < photos.length - 1 && (
                <IconButton
                  onClick={goToNext}
                  sx={{
                    position: 'absolute',
                    right: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 2,
                    bgcolor: alpha('#000000', 0.5),
                    color: 'white',
                    '&:hover': {
                      bgcolor: alpha('#000000', 0.7),
                    }
                  }}
                >
                  <ArrowForwardIos />
                </IconButton>
              )}
            </DialogContent>

            {/* Thumbnail Strip */}
            <Paper
              elevation={4}
              sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                bgcolor: alpha('#000000', 0.9),
                p: 2,
                borderRadius: 0
              }}
            >
              <Box
                ref={setThumbnailsRef}
                sx={{
                  display: 'flex',
                  gap: 1,
                  overflowX: 'auto',
                  '&::-webkit-scrollbar': {
                    height: 4,
                  },
                  '&::-webkit-scrollbar-track': {
                    bgcolor: alpha('#ffffff', 0.1),
                    borderRadius: 2,
                  },
                  '&::-webkit-scrollbar-thumb': {
                    bgcolor: alpha('#ffffff', 0.3),
                    borderRadius: 2,
                    '&:hover': {
                      bgcolor: alpha('#ffffff', 0.5),
                    }
                  }
                }}
              >
                {photos.map((photo, index) => (
                  <Box
                    key={photo.id}
                    onClick={() => goToPhoto(index)}
                    sx={{
                      minWidth: 60,
                      height: 60,
                      cursor: 'pointer',
                      borderRadius: 1,
                      overflow: 'hidden',
                      border: index === selectedPhotoIndex ? `2px solid ${theme.palette.primary.main}` : '2px solid transparent',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        transform: 'scale(1.05)',
                        border: `2px solid ${alpha(theme.palette.primary.main, 0.7)}`
                      }
                    }}
                  >
                    <Box
                      component="img"
                      src={photo.url}
                      alt={`Thumbnail ${index + 1}`}
                      sx={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                  </Box>
                ))}
              </Box>
            </Paper>
          </Box>
        )}
      </Dialog>
    </Container>
  );
};

export default EnhancedPhotoGallery;
