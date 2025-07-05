import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Paper,
  Alert,
  Snackbar,
  useTheme,
  alpha
} from '@mui/material';
import {
  QrCode,
  Download,
  ContentCopy,
  CheckCircle,
  Launch
} from '@mui/icons-material';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  eventId: string;
  title: string;
}

const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ eventId, title }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const theme = useTheme();
  
  const eventUrl = `${window.location.origin}/event/${eventId}`;

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, eventUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      }, (error: Error | null | undefined) => {
        if (error) console.error('QR code generation error:', error);
      });
    }
  }, [eventUrl]);

  const downloadQR = () => {
    if (canvasRef.current) {
      const link = document.createElement('a');
      link.download = `${title}-qr-code.png`;
      link.href = canvasRef.current.toDataURL();
      link.click();
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopySuccess(true);
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
    }
  };

  const handleSnackbarClose = () => {
    setCopySuccess(false);
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto' }}>
      <Card elevation={3} sx={{ mb: 3 }}>
        <CardContent sx={{ textAlign: 'center', p: 4 }}>
          <Box sx={{ mb: 3 }}>
            <QrCode sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
            <Typography variant="h5" gutterBottom color="primary">
              Share Your Event Gallery
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Guests can scan this QR code to upload and view photos
            </Typography>
          </Box>
          
          <Paper 
            elevation={2}
            sx={{ 
              p: 3, 
              mb: 3,
              bgcolor: alpha(theme.palette.primary.main, 0.02),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`
            }}
          >
            <canvas 
              ref={canvasRef} 
              style={{ 
                maxWidth: '100%',
                height: 'auto',
                marginBottom: theme.spacing(2)
              }} 
            />
            <Typography variant="h6" gutterBottom color="primary">
              {title}
            </Typography>
            <Typography 
              variant="body2" 
              color="primary"
              sx={{ 
                wordBreak: 'break-all',
                bgcolor: 'grey.50',
                p: 1,
                borderRadius: 1,
                fontFamily: 'monospace',
                cursor: 'pointer',
                textDecoration: 'underline',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                }
              }}
              onClick={() => window.open(eventUrl, '_blank')}
            >
              {eventUrl}
            </Typography>
          </Paper>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap', mb: 3 }}>
            <Button 
              onClick={() => window.open(eventUrl, '_blank')} 
              variant="contained"
              startIcon={<Launch />}
              sx={{ px: 3 }}
            >
              Visit Gallery
            </Button>
            <Button 
              onClick={downloadQR} 
              variant="outlined"
              startIcon={<Download />}
              sx={{ px: 3 }}
            >
              Download QR
            </Button>
            <Button 
              onClick={copyLink} 
              variant="outlined"
              startIcon={<ContentCopy />}
              sx={{ px: 3 }}
            >
              Copy Link
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center' }}>
            <CheckCircle sx={{ mr: 1, fontSize: 20 }} />
            Instructions for guests:
          </Typography>
          <Box component="ol" sx={{ pl: 2, m: 0 }}>
            <Box component="li" sx={{ mb: 1 }}>
              <Typography variant="body2">
                Scan the QR code with your phone camera
              </Typography>
            </Box>
            <Box component="li" sx={{ mb: 1 }}>
              <Typography variant="body2">
                Or visit the link above directly
              </Typography>
            </Box>
            <Box component="li" sx={{ mb: 1 }}>
              <Typography variant="body2">
                Upload photos directly from your phone
              </Typography>
            </Box>
            <Box component="li">
              <Typography variant="body2">
                View all event photos in real-time
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Snackbar
        open={copySuccess}
        autoHideDuration={3000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleSnackbarClose} 
          severity="success" 
          sx={{ width: '100%' }}
        >
          Link copied to clipboard!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default QRCodeDisplay;
