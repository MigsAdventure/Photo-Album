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
  alpha,
  Button,
  TextField,
  DialogActions,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Close,
  PhotoLibrary,
  AccessTime,
  ArrowBackIos,
  ArrowForwardIos,
  Email,
  GetApp,
  PlayArrow,
  Videocam,
  Star,
  Security
} from '@mui/icons-material';
import { useSwipeable } from 'react-swipeable';
import { subscribeToPhotos, requestEmailDownload, getEvent } from '../services/photoService';
import { Media, Event } from '../types';
import UpgradeModal from './UpgradeModal';

interface EnhancedPhotoGalleryProps {
  eventId: string;
}

const EnhancedPhotoGallery: React.FC<EnhancedPhotoGalleryProps> = ({ eventId }) => {
  const [photos, setPhotos] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [thumbnailsRef, setThumbnailsRef] = useState<HTMLElement | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Utility function to detect if media is a video
  const isVideo = useCallback((media: Media): boolean => {
    // Check if mediaType is explicitly set to 'video'
    if (media.mediaType === 'video') return true;
    
    // Fallback: check content type or file extension
    const contentType = media.contentType || '';
    const fileName = media.fileName || '';
    
    const videoContentTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'application/mp4'];
    const videoExtensions = ['.mp4', '.mov', '.avi', '.webm'];
    
    return videoContentTypes.some(type => contentType.includes(type)) ||
           videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
  }, []);
  
  // Email download state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState('');
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    const unsubscribe = subscribeToPhotos(eventId, (newPhotos) => {
      setPhotos(newPhotos);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [eventId]);

  // Load event data for plan information
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const eventData = await getEvent(eventId);
        setEvent(eventData);
      } catch (error) {
        console.error('Failed to load event data:', error);
      } finally {
        setEventLoading(false);
      }
    };
    
    loadEvent();
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
            No media yet
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Photos and videos will appear here as guests upload them!
          </Typography>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
            <PhotoLibrary sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h4" color="primary">
              Event Gallery
            </Typography>
          </Box>
          
          {/* Plan Status and Photo Limit */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Photo Count/Limit Display */}
            {!eventLoading && event && (
              <Chip 
                label={
                  event.planType === 'premium' 
                    ? `${photos.length} photos • Unlimited`
                    : `${photos.length}/${event.photoLimit} photos`
                }
                color={
                  event.planType === 'premium' 
                    ? 'success'
                    : photos.length >= event.photoLimit 
                      ? 'error' 
                      : 'primary'
                }
                variant="outlined"
                sx={{ fontWeight: 'bold' }}
              />
            )}
            
            {/* Plan Status Indicator */}
            {!eventLoading && event && (
              <Chip
                icon={event.planType === 'premium' ? <Star /> : <Security />}
                label={event.planType === 'premium' ? 'Premium Plan' : 'Free Trial'}
                color={event.planType === 'premium' ? 'warning' : 'default'}
                variant={event.planType === 'premium' ? 'filled' : 'outlined'}
                sx={{
                  fontWeight: 'bold',
                  ...(event.planType === 'premium' && {
                    background: 'linear-gradient(45deg, #ffd700, #ffed4e)',
                    color: '#000',
                    '& .MuiChip-icon': {
                      color: '#000'
                    }
                  })
                }}
              />
            )}
            
            {/* Upgrade Button for Free Users */}
            {!eventLoading && event && event.planType === 'free' && (
              <Button
                variant="contained"
                color="primary"
                size="small"
                onClick={() => setShowUpgradeModal(true)}
                startIcon={<Star />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 'bold',
                  background: 'linear-gradient(45deg, #d81b60, #8e24aa)',
                  '&:hover': {
                    background: 'linear-gradient(45deg, #c2185b, #7b1fa2)',
                  }
                }}
              >
                Upgrade
              </Button>
            )}
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body1" color="text.secondary">
            Live updates from your guests - photos appear as they're uploaded!
          </Typography>
          
          {/* Limit Warning for Free Users */}
          {!eventLoading && event && event.planType === 'free' && photos.length >= event.photoLimit && (
            <Typography variant="body2" color="error" sx={{ fontWeight: 'bold' }}>
              Upload limit reached • Upgrade for unlimited photos
            </Typography>
          )}
        </Box>
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
              {isVideo(photo) ? (
                // Video thumbnail with play button overlay
                <Box sx={{ position: 'relative', height: 200 }}>
                  <Box
                    component="img"
                    src={photo.url + '#t=1'}
                    alt={photo.fileName || 'Video thumbnail'}
                    sx={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      backgroundColor: 'grey.900'
                    }}
                    onError={(e) => {
                      // Fallback: show a dark background with video icon
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent) {
                        parent.style.backgroundColor = '#424242';
                        parent.style.display = 'flex';
                        parent.style.alignItems = 'center';
                        parent.style.justifyContent = 'center';
                      }
                    }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      bgcolor: alpha('#000000', 0.7),
                      borderRadius: '50%',
                      width: 60,
                      height: 60,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        bgcolor: alpha('#000000', 0.9),
                        transform: 'translate(-50%, -50%) scale(1.1)'
                      }
                    }}
                  >
                    <PlayArrow sx={{ fontSize: 30, color: 'white', ml: 0.5 }} />
                  </Box>
                  <Chip
                    icon={<Videocam />}
                    label="Video"
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      bgcolor: alpha('#000000', 0.7),
                      color: 'white',
                      '& .MuiChip-icon': { color: 'white' }
                    }}
                  />
                </Box>
              ) : (
                // Regular image
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
              )}
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

              {/* Photo or Video Display */}
              {isVideo(currentPhoto) ? (
                <Box
                  component="video"
                  controls
                  autoPlay={false}
                  muted
                  sx={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    userSelect: 'none'
                  }}
                >
                  <source src={currentPhoto.url} type={currentPhoto.contentType || 'video/mp4'} />
                  Your browser does not support the video tag.
                </Box>
              ) : (
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
              )}

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

      {/* Email Download Dialog */}
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
                📧 The download link will expire in 48 hours for security.
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

      {/* Upgrade Modal for Free Users */}
      {event && (
        <UpgradeModal
          open={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
          eventId={event.id}
          currentPhotoCount={event.photoCount || 0}
          onUpgradeSuccess={async () => {
            setShowUpgradeModal(false);
            console.log('🔄 Upgrade successful, refreshing event data...');
            
            try {
              // Wait a moment for server to process upgrade
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Force refresh event data
              const updatedEvent = await getEvent(event.id);
              if (updatedEvent) {
                setEvent(updatedEvent);
                console.log('✅ Event data refreshed:', updatedEvent.planType, updatedEvent.photoLimit);
              } else {
                console.warn('⚠️ Failed to get updated event data');
              }
            } catch (error) {
              console.error('❌ Error refreshing event data:', error);
              // Fallback: reload the page to ensure fresh data
              window.location.reload();
            }
          }}
        />
      )}
    </Container>
  );
};

export default EnhancedPhotoGallery;
