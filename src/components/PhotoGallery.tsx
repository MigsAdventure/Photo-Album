import React, { useState, useEffect } from 'react';
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
  Zoom
} from '@mui/material';
import {
  Close,
  PhotoLibrary,
  AccessTime,
  FileDownload
} from '@mui/icons-material';
import { subscribeToPhotos } from '../services/photoService';
import { Photo } from '../types';

interface PhotoGalleryProps {
  weddingId: string;
}

const PhotoGallery: React.FC<PhotoGalleryProps> = ({ weddingId }) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    const unsubscribe = subscribeToPhotos(weddingId, (newPhotos) => {
      setPhotos(newPhotos);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [weddingId]);

  const openModal = (photo: Photo) => {
    setSelectedPhoto(photo);
  };

  const closeModal = () => {
    setSelectedPhoto(null);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const downloadPhoto = (photo: Photo) => {
    const link = document.createElement('a');
    link.href = photo.url;
    link.download = photo.fileName || 'wedding-photo.jpg';
    link.target = '_blank';
    link.click();
  };

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
            Wedding Gallery
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
              onClick={() => openModal(photo)}
            >
              <CardMedia
                component="img"
                height={200}
                image={photo.url}
                alt={photo.fileName || 'Wedding photo'}
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

      <Dialog
        open={!!selectedPhoto}
        onClose={closeModal}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
        TransitionComponent={Fade}
      >
        {selectedPhoto && (
          <>
            <DialogTitle sx={{ 
              display: 'flex', 
              alignItems: 'center',
              bgcolor: 'grey.50'
            }}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6">
                  {selectedPhoto.fileName || 'Wedding Photo'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Uploaded {formatDate(selectedPhoto.uploadedAt)}
                </Typography>
              </Box>
              <IconButton
                onClick={() => downloadPhoto(selectedPhoto)}
                sx={{ mr: 1 }}
                title="Download"
              >
                <FileDownload />
              </IconButton>
              <IconButton onClick={closeModal} title="Close">
                <Close />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0, bgcolor: 'black' }}>
              <Box
                component="img"
                src={selectedPhoto.url}
                alt={selectedPhoto.fileName || 'Wedding photo'}
                sx={{
                  width: '100%',
                  maxWidth: '100%',
                  height: 'auto',
                  display: 'block',
                  maxHeight: isMobile ? '80vh' : '70vh',
                  objectFit: 'contain'
                }}
              />
            </DialogContent>
          </>
        )}
      </Dialog>
    </Container>
  );
};

export default PhotoGallery;
