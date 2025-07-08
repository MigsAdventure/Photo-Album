import React, { useState, useRef, useEffect } from 'react';
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
  useMediaQuery
} from '@mui/material';
import {
  PhotoCamera,
  PhotoLibrary,
  FileDownload,
  Warning,
  QrCode,
  Close,
  Download,
  ContentCopy
} from '@mui/icons-material';
import { downloadAllPhotos, uploadPhoto } from '../services/photoService';
import { Photo, UploadProgress } from '../types';
import QRCode from 'qrcode';

interface BottomNavbarProps {
  photos: Photo[];
  eventId: string;
  onUploadComplete?: () => void;
}

const BottomNavbar: React.FC<BottomNavbarProps> = ({ photos, eventId, onUploadComplete }) => {
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const eventUrl = `${window.location.origin}/event/${eventId}`;

  const handleFileSelect = async (files: FileList) => {
    const imageFiles = Array.from(files).filter(file => 
      file.type.startsWith('image/')
    );

    if (imageFiles.length === 0) {
      alert('Please select valid image files');
      return;
    }

    setUploading(true);
        const initialProgress: UploadProgress[] = imageFiles.map((file, index) => ({
          fileName: file.name,
          progress: 0,
          status: 'uploading' as const,
          fileIndex: index,
          file,
          canRetry: false
        }));
    setUploadProgress(initialProgress);

    // Upload files concurrently
    const uploadPromises = imageFiles.map(async (file, index) => {
      try {
        await uploadPhoto(file, eventId, (progress) => {
          setUploadProgress(prev => 
            prev.map((item, i) => 
              i === index ? { ...item, progress } : item
            )
          );
        });

        setUploadProgress(prev => 
          prev.map((item, i) => 
            i === index ? { ...item, status: 'completed' } : item
          )
        );
      } catch (error) {
        console.error('Upload failed:', error);
        setUploadProgress(prev => 
          prev.map((item, i) => 
            i === index ? { ...item, status: 'error' } : item
          )
        );
      }
    });

    await Promise.all(uploadPromises);
    
    // Clear progress after a delay
    setTimeout(() => {
      setUploading(false);
      setUploadProgress([]);
      onUploadComplete?.();
    }, 2000);
  };

  const handleCameraClick = () => {
    const cameraInput = document.getElementById('bottom-camera-input') as HTMLInputElement;
    cameraInput?.click();
  };

  const handleGalleryClick = () => {
    const galleryInput = document.getElementById('bottom-gallery-input') as HTMLInputElement;
    galleryInput?.click();
  };

  const handleDownloadClick = () => {
    if (photos.length === 0) {
      alert('No photos to download');
      return;
    }
    setShowDownloadDialog(true);
  };

  const handleConfirmDownload = async () => {
    setShowDownloadDialog(false);
    setDownloading(true);
    setDownloadProgress({ current: 0, total: photos.length });

    try {
      await downloadAllPhotos(eventId, (current, total) => {
        setDownloadProgress({ current, total });
      });
      
      // Show completion message
      setTimeout(() => {
        setDownloading(false);
        setDownloadProgress({ current: 0, total: 0 });
      }, 1000);
    } catch (error) {
      console.error('Download failed:', error);
      setDownloading(false);
      alert('Download failed. Please try again.');
    }
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
        accept="image/*"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        capture="environment"
      />
      
      <input
        id="bottom-gallery-input"
        type="file"
        multiple
        accept="image/*"
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

      {/* Download Confirmation Dialog */}
      <Dialog open={showDownloadDialog} onClose={() => setShowDownloadDialog(false)}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          <Warning sx={{ mr: 1, color: 'warning.main' }} />
          Download All Photos
        </DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to download all <strong>{photos.length}</strong> photo{photos.length !== 1 ? 's' : ''} to your device?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            The photos will be downloaded one by one to your default download folder.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDownloadDialog(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirmDownload} variant="contained">
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Download Progress Dialog */}
      <Dialog open={downloading} sx={{ zIndex: 1500 }}>
        <DialogTitle>Downloading Photos</DialogTitle>
        <DialogContent sx={{ minWidth: 300 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Downloaded {downloadProgress.current} of {downloadProgress.total} photos
          </Typography>
          <LinearProgress
            variant="determinate"
            value={(downloadProgress.current / downloadProgress.total) * 100}
            sx={{ mt: 2, height: 8, borderRadius: 4 }}
          />
          {downloadProgress.current === downloadProgress.total && downloadProgress.total > 0 && (
            <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
              ✅ All photos downloaded successfully!
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Progress Dialog */}
      <Dialog open={uploading} sx={{ zIndex: 1500 }}>
        <DialogTitle>Uploading Photos</DialogTitle>
        <DialogContent sx={{ minWidth: 300 }}>
          {uploadProgress.map((item, index) => (
            <Box key={index} sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {item.fileName}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={item.progress}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: item.status === 'error' ? 'error.main' : 
                           item.status === 'completed' ? 'success.main' : 'primary.main'
                  }
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {item.status === 'uploading' && `${Math.round(item.progress)}%`}
                {item.status === 'completed' && '✅ Uploaded'}
                {item.status === 'error' && '❌ Failed'}
              </Typography>
            </Box>
          ))}
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

        <DialogActions sx={{ p: 3, justifyContent: 'center', gap: 2 }}>
          <Button 
            onClick={downloadQR} 
            variant="outlined"
            startIcon={<Download />}
            sx={{ minWidth: 130 }}
          >
            Download QR
          </Button>
          <Button 
            onClick={copyQRLink} 
            variant="outlined"
            startIcon={<ContentCopy />}
            sx={{ minWidth: 130 }}
          >
            Copy Link
          </Button>
          <Button 
            onClick={() => window.open(eventUrl, '_blank')} 
            variant="contained"
            sx={{ minWidth: 130 }}
          >
            Visit Gallery
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default BottomNavbar;
