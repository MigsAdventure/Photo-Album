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
  Security,
  Delete,
  Download
} from '@mui/icons-material';
import { useSwipeable } from 'react-swipeable';
import { subscribeToPhotos, requestEmailDownload, getEvent, deletePhoto, getPhotoOwnershipInfo } from '../services/photoService';
import { getCurrentUserEmail, onAuthChange } from '../services/authService';
import { getUploadState, explainUploadState } from '../services/planService';
import { preloadOptimalUrls } from '../services/r2UrlService';
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

  // Delete photo state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [photoToDelete, setPhotoToDelete] = useState<Media | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  
  // Long-press detection for mobile
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [ownedPhotos, setOwnedPhotos] = useState<Set<string>>(new Set());
  
  // R2 URL optimization state
  const [optimizedUrls, setOptimizedUrls] = useState<Map<string, { url: string; source: 'r2' | 'firebase' }>>(new Map());
  const [urlOptimizationInProgress, setUrlOptimizationInProgress] = useState(false);
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Background URL optimization for cost savings
  const optimizeMediaUrls = useCallback(async (mediaList: Media[]) => {
    if (urlOptimizationInProgress) return;
    
    setUrlOptimizationInProgress(true);
    console.log('💾 Starting R2 URL optimization for', mediaList.length, 'media items...');
    
    try {
      // Prepare media items for optimization
      const mediaItems = mediaList.map(media => ({
        firebaseUrl: media.url,
        r2Key: media.r2Key,
        id: media.id
      }));
      
      // Use preloading service to test R2 URLs in batches
      const urlResults = await preloadOptimalUrls(mediaItems);
      
      // Update optimized URLs state
      setOptimizedUrls(prevUrls => {
        const newOptimizedUrls = new Map(prevUrls);
        let r2Count = 0;
        let firebaseCount = 0;
        
        Array.from(urlResults.entries()).forEach(([firebaseUrl, result]) => {
          const media = mediaList.find(m => m.url === firebaseUrl);
          if (media) {
            newOptimizedUrls.set(media.id, result);
            if (result.source === 'r2') {
              r2Count++;
            } else {
              firebaseCount++;
            }
          }
        });
        
        console.log(`✅ URL optimization complete: ${r2Count} R2 URLs, ${firebaseCount} Firebase URLs`);
        console.log(`💰 Estimated bandwidth cost savings: ${Math.round((r2Count / mediaList.length) * 100)}%`);
        
        return newOptimizedUrls;
      });
      
    } catch (error) {
      console.warn('⚠️ URL optimization failed, falling back to Firebase URLs:', error);
    } finally {
      setUrlOptimizationInProgress(false);
    }
  }, [urlOptimizationInProgress]);

  useEffect(() => {
    const unsubscribe = subscribeToPhotos(eventId, async (newPhotos) => {
      setPhotos(newPhotos);
      setLoading(false);

      // Optimize URLs for cost savings using R2 when available
      if (newPhotos.length > 0) {
        optimizeMediaUrls(newPhotos);
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Track sign-in, so an organizer opening their own gallery gets moderation
  // controls without having to go via the dashboard.
  const [signedInEmail, setSignedInEmail] = useState<string | null>(getCurrentUserEmail());

  useEffect(() => onAuthChange((user) => setSignedInEmail(user?.email?.toLowerCase() ?? null)), []);

  // Which photos does this browser get a delete affordance for?
  //
  // A guest sees it on their own uploads. An organizer signed in as this event's
  // owner sees it on everything, because moderation is the point — they need to
  // remove something a guest should not have posted (finding UX-2).
  //
  // Derived rather than computed inside the photo subscription: `event` and
  // `photos` load from two independent effects, so a subscription callback that
  // read `event` would see null whenever photos arrived first, and never
  // recompute once the event landed. Organizers would intermittently get no
  // controls, depending on which request won — the kind of bug that reproduces
  // only on a slow connection.
  //
  // Both paths are UI hints. delete-photo.js re-checks independently, so being
  // wrong here shows or hides an icon and nothing more.
  useEffect(() => {
    const isOrganizer = Boolean(
      signedInEmail && event?.organizerEmail?.toLowerCase() === signedInEmail
    );

    const owned = new Set<string>();
    for (const photo of photos) {
      if (isOrganizer || getPhotoOwnershipInfo(photo.id).canDelete) {
        owned.add(photo.id);
      }
    }
    setOwnedPhotos(owned);
  }, [photos, event, signedInEmail]);

  // Preview URL for grid tiles.
  //
  // The grid used to load every photo at full resolution — a 400-photo wedding
  // meant several hundred megabytes over cellular before anything was usable,
  // at the reception, on the venue's wifi (finding UX-3). Uploads now generate a
  // ~30KB preview, so the grid pulls roughly 1% of what it did.
  //
  // Photos uploaded before thumbnails existed have none, and fall back to the
  // full image — so the grid gets progressively lighter as old events age out
  // rather than breaking for them.
  const getThumbnailUrl = useCallback((media: Media): string => {
    if (media.thumbnailUrl) return media.thumbnailUrl;
    const optimized = optimizedUrls.get(media.id);
    return optimized ? optimized.url : media.url;
  }, [optimizedUrls]);

  // Full-resolution URL, for the lightbox and downloads.
  const getMediaUrl = useCallback((media: Media): string => {
    const optimized = optimizedUrls.get(media.id);
    if (optimized) {
      return optimized.url;
    }
    // Fallback to Firebase URL while optimization is in progress
    return media.url;
  }, [optimizedUrls]);

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

  // Delete handlers
  const handleDeleteRequest = (photo: Media) => {
    setPhotoToDelete(photo);
    setDeleteDialogOpen(true);
    setDeleteError('');
  };

  const handleDeleteConfirm = async () => {
    if (!photoToDelete) return;
    
    setDeleteLoading(true);
    setDeleteError('');
    
    try {
      await deletePhoto(photoToDelete.id);
      console.log('✅ Photo deleted successfully:', photoToDelete.id);
      setDeleteDialogOpen(false);
      setPhotoToDelete(null);
      
      // Update ownership tracking
      setOwnedPhotos(prev => {
        const updated = new Set(prev);
        updated.delete(photoToDelete.id);
        return updated;
      });
      
    } catch (error: any) {
      console.error('❌ Photo deletion failed:', error);
      setDeleteError(error.message || 'Failed to delete photo. Please try again.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Touch event handlers for long-press detection
  const handleTouchStart = (photo: Media, event: React.TouchEvent) => {
    console.log('🖐️ Touch start for photo:', photo.id, 'owned:', ownedPhotos.has(photo.id));
    
    if (!ownedPhotos.has(photo.id)) {
      console.log('❌ Photo not owned, skipping long-press setup');
      return;
    }
    
    // Prevent default to avoid interference with click events
    event.preventDefault();
    event.stopPropagation();
    
    const timer = setTimeout(() => {
      console.log('⏰ Long-press triggered for photo:', photo.id);
      
      // Trigger haptic feedback on supported devices
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      
      handleDeleteRequest(photo);
    }, 600); // 600ms long press
    
    setLongPressTimer(timer);
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    console.log('🖐️ Touch end');
    
    if (longPressTimer) {
      console.log('⏹️ Clearing long-press timer');
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    // Don't prevent default here to allow normal tap behavior if no long-press
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    console.log('🖐️ Touch move - canceling long-press');
    
    // Cancel long press if user moves finger
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  // Right-click handler for desktop
  const handleContextMenu = (photo: Media, event: React.MouseEvent) => {
    console.log('🖱️ Right-click on photo:', photo.id, 'owned:', ownedPhotos.has(photo.id));
    
    event.preventDefault();
    event.stopPropagation();
    
    if (ownedPhotos.has(photo.id)) {
      console.log('✅ Showing delete dialog for owned photo');
      handleDeleteRequest(photo);
    } else {
      console.log('❌ Photo not owned, no delete option');
    }
  };

  // Enhanced click handler that accounts for long-press
  const handlePhotoClick = (photo: Media, index: number, event: React.MouseEvent | React.TouchEvent) => {
    // Don't open modal if this was part of a long-press sequence
    if (longPressTimer) {
      console.log('🚫 Suppressing click due to active long-press timer');
      return;
    }
    
    console.log('👆 Opening photo modal for index:', index);
    openModal(index);
  };

  // Download state
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(new Map());

  // Smart download handler with R2 proxy for CORS-free downloads
  const handleDownloadSingle = async (media: Media) => {
    try {
      console.log('📥 Starting download for:', media.fileName);
      
      // Add to downloading set to show loading state
      setDownloadingIds(prev => new Set(Array.from(prev).concat(media.id)));
      
      const mediaIsVideo = isVideo(media);
      const mediaType = mediaIsVideo ? 'video' : 'image';
      
      // OPTION 1: Check if we have saved R2 key - use R2 proxy (best option)
      const hasR2Key = media.r2Key && typeof media.r2Key === 'string' && media.r2Key.trim().length > 0;
      
      if (hasR2Key) {
        console.log(`🔗 Using R2 proxy for ${mediaType} with key:`, media.r2Key);
        
        try {
          // Use R2 proxy to avoid CORS issues
          const proxyUrl = `/.netlify/functions/r2-download?key=${encodeURIComponent(media.r2Key!)}&filename=${encodeURIComponent(media.fileName || 'download')}`;
          
          const response = await fetch(proxyUrl);
          if (!response.ok) {
            throw new Error(`R2 proxy failed: ${response.status}`);
          }
          
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          a.download = media.fileName || `${mediaType}_${media.id}${mediaIsVideo ? '.mp4' : '.jpg'}`;
          a.style.display = 'none';
          
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          // Clean up blob URL
          setTimeout(() => URL.revokeObjectURL(url), 100);
          
          console.log(`✅ R2 proxy ${mediaType} download successful!`);
          return; // Success! Exit early
          
        } catch (r2Error) {
          console.warn(`⚠️ R2 proxy download failed:`, r2Error);
          // Continue to server proxy fallback
        }
      }
      
      // OPTION 2: Server proxy fallback (skip for videos due to size limits)
      if (!mediaIsVideo) { // Skip server proxy for videos entirely due to 10s timeout
        // OPTION 2: Server proxy fallback (for when R2 copy isn't ready yet)
        console.log(`🔄 Using server proxy for ${mediaType} (no R2 key available yet)`);
        
        try {
          // Use fetch to get proper download instead of navigation
          const downloadUrl = `/.netlify/functions/download?id=${media.id}`;
          const response = await fetch(downloadUrl);
          
          if (!response.ok) {
            throw new Error(`Server proxy failed: ${response.status}`);
          }
          
          // Get the blob and create download
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          a.download = media.fileName || `${mediaType}_${media.id}${mediaIsVideo ? '.mp4' : '.jpg'}`;
          a.style.display = 'none';
          
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          // Clean up blob URL
          setTimeout(() => URL.revokeObjectURL(url), 100);
          
          console.log(`✅ Server proxy ${mediaType} download successful`);
          
        } catch (serverError) {
          console.warn(`⚠️ Server proxy failed:`, serverError);
          
          // OPTION 3: Final fallback - Firebase direct URL (may not work due to CORS)
          console.log(`🔄 Using Firebase direct URL fallback for ${mediaType}`);
          
          // Try Firebase direct download as last resort
          const a = document.createElement('a');
          a.href = media.url;
          a.download = media.fileName || `${mediaType}_${media.id}${mediaIsVideo ? '.mp4' : '.jpg'}`;
          a.target = '_blank'; // Open in new tab as fallback
          a.style.display = 'none';
          
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          console.log(`⚠️ Firebase direct ${mediaType} download attempted (may open in new tab)`);
        }
      }
      
    } catch (error) {
      console.error('❌ Download failed:', error);
      alert(`Failed to download ${isVideo(media) ? 'video' : 'image'}. Please try again or use bulk email download.`);
      
    } finally {
      // Remove loading state after delay
      setTimeout(() => {
        setDownloadingIds(prev => {
          const updated = new Set(prev);
          updated.delete(media.id);
          return updated;
        });
        
        setDownloadProgress(prev => {
          const updated = new Map(prev);
          updated.delete(media.id);
          return updated;
        });
      }, 1000);
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
                    : `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`
                }
                color={
                  event.planType === 'premium'
                    ? 'success'
                    : getUploadState(event).canUpload
                      ? 'primary'
                      : 'default'
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
          <Box>
            <Typography variant="body1" color="text.secondary">
              Live updates from your guests - photos appear as they're uploaded!
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: '0.875rem' }}>
              {isMobile ? 'Hold down' : 'Right-click'} your own photos to delete them
            </Typography>
          </Box>
          
          {/* Limit Warning for Free Users */}
          {/*
            Was: photos.length >= event.photoLimit — the count-based paywall UX-1
            removed. It survived here after BottomNavbar was fixed, so free events
            still showed guests "Upload limit reached • Upgrade" permanently while
            uploads carried on working. Now driven by the actual window state, and
            only shown once uploads have genuinely closed.
          */}
          {!eventLoading && event && !getUploadState(event).canUpload && (
            <Typography variant="body2" color="error" sx={{ fontWeight: 'bold' }}>
              {explainUploadState(getUploadState(event), 'guest')}
            </Typography>
          )}
        </Box>
      </Box>

      {/* No Media Message */}
      {photos.length === 0 ? (
        <Container maxWidth="sm" sx={{ px: 0 }}>
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
      ) : (
        /* Photo Grid */
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
                },
                ...(ownedPhotos.has(photo.id) && {
                  border: `2px solid ${alpha(theme.palette.success.main, 0.3)}`,
                  '&:hover': {
                    transform: 'scale(1.02)',
                    boxShadow: theme.shadows[8],
                    borderColor: alpha(theme.palette.success.main, 0.6)
                  }
                })
              }}
              onClick={(e) => handlePhotoClick(photo, index, e)}
              onContextMenu={(e) => handleContextMenu(photo, e)}
              onTouchStart={(e) => handleTouchStart(photo, e)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              {isVideo(photo) ? (
                /*
                  A video tile shows a still, not a <video> element.
                  Phase 3 pointed this at getThumbnailUrl but left
                  component="video". thumbnailUrl is a WebP/JPEG frame grab
                  (thumbnailService.generateVideoThumbnail), and a video element
                  cannot decode a still image — so it fired onError and every
                  video tile in every gallery fell back to a 🎬 emoji on a
                  gradient. Strictly worse than before the thumbnail work, which
                  at least loaded the video and seeked to a real frame.

                  When the photo predates thumbnails, getThumbnailUrl falls back
                  to the media URL, which an <img> cannot render either — so
                  those keep the placeholder, which is the correct outcome for a
                  video with no poster.
                */
                <Box sx={{ position: 'relative', height: 200, overflow: 'hidden' }}>
                  <Box
                    component={photo.thumbnailUrl ? 'img' : 'video'}
                    loading="lazy"
                    src={getThumbnailUrl(photo)}
                    muted
                    preload="metadata"
                    sx={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      backgroundColor: 'grey.900'
                    }}
                    onLoadedMetadata={(e: React.SyntheticEvent<HTMLElement>) => {
                      // Only meaningful on the <video> fallback path, for photos
                      // that predate thumbnails. Seek in a little way — the first
                      // frame of a phone video is usually black.
                      const video = e.target as HTMLVideoElement;
                      if (video.tagName === 'VIDEO') {
                        video.currentTime = Math.min(3, video.duration * 0.1);
                      }
                    }}
                    onError={(e: React.SyntheticEvent<HTMLElement>) => {
                      // Last resort: no poster and the video will not preview.
                      const video = e.target as HTMLVideoElement;
                      const parent = video.parentElement;
                      if (parent) {
                        video.style.display = 'none';
                        parent.style.background = 'linear-gradient(135deg, #434343 0%, #000000 100%)';
                        parent.style.display = 'flex';
                        parent.style.alignItems = 'center';
                        parent.style.justifyContent = 'center';
                        
                        // Add fallback icon
                        const icon = document.createElement('div');
                        icon.innerHTML = '🎬';
                        icon.style.fontSize = '60px';
                        parent.appendChild(icon);
                      }
                    }}
                  />
                  
                  {/* Play Button Overlay */}
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
                  
                  {/* Video Label Chip */}
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
                  loading="lazy"
                  height={200}
                  image={getThumbnailUrl(photo)}
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
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <AccessTime sx={{ fontSize: 16, mr: 0.5 }} />
                  <Typography variant="caption">
                    {formatDate(photo.uploadedAt)}
                  </Typography>
                </Box>
                
                {/* Ownership indicator */}
                {ownedPhotos.has(photo.id) && (
                  <Chip
                    label="My media"
                    size="small"
                    sx={{
                      height: 18,
                      bgcolor: alpha('#000000', 0.3),
                      color: 'white',
                      fontSize: '0.65rem',
                      fontWeight: 500,
                      '& .MuiChip-label': {
                        px: 1
                      }
                    }}
                  />
                )}
              </Box>
            </Card>
          </Zoom>
        ))}
        </Box>
      )}

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
              <Box sx={{ display: 'flex', gap: 1 }}>
                {/* Only show download button for images, not videos */}
                {!isVideo(currentPhoto) && (
                  <IconButton 
                    onClick={() => handleDownloadSingle(currentPhoto)} 
                    sx={{ color: 'white', position: 'relative' }} 
                    title={
                      downloadingIds.has(currentPhoto.id) 
                        ? 'Downloading...' 
                        : 'Download'
                    }
                    disabled={downloadingIds.has(currentPhoto.id)}
                  >
                    {downloadingIds.has(currentPhoto.id) ? (
                      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress 
                          size={24} 
                          sx={{ color: 'white' }}
                          variant={downloadProgress.has(currentPhoto.id) ? 'determinate' : 'indeterminate'}
                          value={downloadProgress.get(currentPhoto.id) || 0}
                        />
                        {downloadProgress.has(currentPhoto.id) && (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: '50%',
                              left: '50%',
                              transform: 'translate(-50%, -50%)',
                              color: 'white',
                              fontSize: '0.6rem',
                              fontWeight: 'bold'
                            }}
                          >
                            {Math.round(downloadProgress.get(currentPhoto.id) || 0)}%
                          </Box>
                        )}
                      </Box>
                    ) : (
                      <Download />
                    )}
                  </IconButton>
                )}
                <IconButton onClick={closeModal} sx={{ color: 'white' }} title="Close">
                  <Close />
                </IconButton>
              </Box>
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
                  sx={{
                    position: 'relative',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Box
                    key={currentPhoto.id} // Force new video element for each video
                    component="video"
                    src={getMediaUrl(currentPhoto)} // Use optimized R2 URL when available
                    controls
                    autoPlay={false}
                    muted
                    preload="metadata"
                    sx={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      userSelect: 'none',
                      // Prevent video controls from interfering with navigation on touch devices
                      '&:focus': {
                        outline: 'none'
                      }
                    }}
                    onTouchStart={(e) => {
                      // Allow video controls to work but prevent event bubbling during swipe
                      e.stopPropagation();
                    }}
                    onTouchMove={(e) => {
                      // Allow normal touch interactions within video player
                      e.stopPropagation();
                    }}
                    onTouchEnd={(e) => {
                      // Prevent touch end from interfering with swipe
                      e.stopPropagation();
                    }}
                  />
                </Box>
              ) : (
                <Box
                  component="img"
                  src={getMediaUrl(currentPhoto)}
                  alt={currentPhoto.fileName || 'Event photo'}
                  sx={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    userSelect: 'none'
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
                      },
                      position: 'relative'
                    }}
                  >
                    {isVideo(photo) ? (
                      // Video thumbnail with actual frame
                      <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                        <Box
                          component="video"
                          src={photo.url}
                          muted
                          preload="metadata"
                          sx={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            backgroundColor: 'grey.800'
                          }}
                          onLoadedMetadata={(e) => {
                            const video = e.target as HTMLVideoElement;
                            // Seek to 3 seconds for thumbnail
                            video.currentTime = Math.min(3, video.duration * 0.1);
                          }}
                          onError={(e) => {
                            // Fallback: show video icon if frame extraction fails
                            const video = e.target as HTMLVideoElement;
                            const parent = video.parentElement;
                            if (parent) {
                              video.style.display = 'none';
                              parent.style.background = 'linear-gradient(135deg, #424242 0%, #212121 100%)';
                              parent.style.display = 'flex';
                              parent.style.alignItems = 'center';
                              parent.style.justifyContent = 'center';
                              
                              // Add fallback icon
                              const icon = document.createElement('div');
                              icon.innerHTML = '🎬';
                              icon.style.fontSize = '20px';
                              parent.appendChild(icon);
                            }
                          }}
                        />
                        {/* Small play icon overlay for video thumbnails */}
                        <Box
                          sx={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            bgcolor: alpha('#000000', 0.7),
                            borderRadius: '50%',
                            width: 20,
                            height: 20,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none'
                          }}
                        >
                          <PlayArrow sx={{ fontSize: 10, color: 'white', ml: 0.2 }} />
                        </Box>
                      </Box>
                    ) : (
                      // Regular photo thumbnail
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
                    )}
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

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setPhotoToDelete(null);
          setDeleteError('');
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          <Delete sx={{ mr: 1, color: 'error.main' }} />
          Delete {photoToDelete && isVideo(photoToDelete) ? 'Video' : 'Photo'}
        </DialogTitle>
        
        <DialogContent>
          {deleteError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          ) : null}
          
          <Typography variant="body1" sx={{ mb: 2 }}>
            Are you sure you want to delete this {photoToDelete && isVideo(photoToDelete) ? 'video' : 'photo'}? This action cannot be undone.
          </Typography>
          
          {photoToDelete && (
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'center', 
              mb: 2,
              border: '2px solid',
              borderColor: 'grey.300',
              borderRadius: 2,
              overflow: 'hidden',
              maxHeight: 200
            }}>
              {isVideo(photoToDelete) ? (
                <Box
                  component="video"
                  src={photoToDelete.url}
                  muted
                  preload="metadata"
                  sx={{
                    maxWidth: '100%',
                    maxHeight: 200,
                    objectFit: 'contain'
                  }}
                />
              ) : (
                <Box
                  component="img"
                  src={photoToDelete.url}
                  alt="Photo to delete"
                  sx={{
                    maxWidth: '100%',
                    maxHeight: 200,
                    objectFit: 'contain'
                  }}
                />
              )}
            </Box>
          )}
          
          <Alert severity="warning" sx={{ mt: 2 }}>
            <Typography variant="body2">
              <strong>Warning:</strong> This will permanently delete the {photoToDelete && isVideo(photoToDelete) ? 'video' : 'photo'} from the event gallery.
            </Typography>
          </Alert>
        </DialogContent>
        
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false);
              setPhotoToDelete(null);
              setDeleteError('');
            }}
            disabled={deleteLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            variant="contained"
            color="error"
            disabled={deleteLoading}
            startIcon={deleteLoading ? <CircularProgress size={20} /> : <Delete />}
          >
            {deleteLoading ? 'Deleting...' : 'Delete'}
          </Button>
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
