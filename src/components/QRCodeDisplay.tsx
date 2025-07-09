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
  Launch,
  Print
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

  const printQR = async () => {
    try {
      // Validate canvas exists and has content
      if (!canvasRef.current) {
        throw new Error('QR code not ready. Please wait a moment and try again.');
      }
      
      // Check if canvas has actual content
      if (canvasRef.current.width === 0 || canvasRef.current.height === 0) {
        throw new Error('QR code still loading. Please wait a moment and try again.');
      }
      
      // Generate data URL with error checking
      const qrDataUrl = canvasRef.current.toDataURL('image/png');
      if (!qrDataUrl || qrDataUrl === 'data:,' || qrDataUrl.length < 100) {
        throw new Error('Failed to generate QR code image. Please try again.');
      }
      
      // Create print window with popup blocker detection
      const printWindow = window.open('', '_blank', 'width=800,height=600');
      if (!printWindow) {
        throw new Error('Print window was blocked. Please allow popups and try again.');
      }
      
      const eventTitle = title || 'Event Gallery';
      
      // Enhanced HTML with better error handling
      const printHTML = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Event QR Code - ${eventTitle}</title>
            <meta charset="utf-8">
            <style>
              @media print {
                * { box-sizing: border-box; }
                body { 
                  margin: 0; 
                  padding: 20px; 
                  font-family: Arial, sans-serif;
                  line-height: 1.4;
                }
                .print-container { 
                  text-align: center; 
                  max-width: 400px; 
                  margin: 0 auto; 
                }
                .qr-image { 
                  width: 200px; 
                  height: 200px; 
                  margin: 20px auto; 
                  border: 2px solid #000; 
                  display: block;
                }
                .title { 
                  font-size: 24px; 
                  font-weight: bold; 
                  margin-bottom: 10px; 
                  color: #000;
                }
                .subtitle { 
                  font-size: 16px; 
                  color: #666; 
                  margin-bottom: 20px; 
                }
                .url { 
                  font-size: 12px; 
                  word-break: break-all; 
                  background: #f5f5f5; 
                  padding: 10px; 
                  border-radius: 5px; 
                  margin: 20px 0;
                  border: 1px solid #ddd;
                }
                .instructions { 
                  font-size: 14px; 
                  color: #333; 
                  margin-top: 20px; 
                  text-align: left; 
                }
                .instructions ol { 
                  padding-left: 20px; 
                  margin: 10px 0;
                }
                .instructions li { 
                  margin-bottom: 8px; 
                }
                .error-message {
                  color: #d32f2f;
                  font-weight: bold;
                  margin: 20px 0;
                }
              }
              @media screen {
                body { 
                  background: #f0f0f0; 
                  padding: 40px; 
                  min-height: 100vh;
                }
                .print-container { 
                  background: white; 
                  padding: 40px; 
                  border-radius: 10px; 
                  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                  margin: 0 auto;
                }
                .print-btn {
                  background: #1976d2;
                  color: white;
                  border: none;
                  padding: 12px 24px;
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: 16px;
                  margin: 20px 10px;
                }
                .print-btn:hover {
                  background: #1565c0;
                }
              }
            </style>
          </head>
          <body>
            <div class="print-container">
              <div class="title">${eventTitle}</div>
              <div class="subtitle">Event Photo Gallery - Scan QR Code to Access</div>
              <img src="${qrDataUrl}" alt="QR Code" class="qr-image" onerror="document.querySelector('.error-message').style.display='block'" />
              <div class="error-message" style="display:none;">
                QR Code failed to load. Please close this window and try again.
              </div>
              <div class="url">${eventUrl}</div>
              <div class="instructions">
                <strong>Instructions for Guests:</strong>
                <ol>
                  <li>Open your phone's camera app</li>
                  <li>Point the camera at this QR code</li>
                  <li>Tap the notification that appears</li>
                  <li>You'll be taken directly to the photo gallery</li>
                  <li>Or manually type the URL above into your browser</li>
                </ol>
                <p><strong>Share your photos:</strong> Upload photos directly from your phone to share with everyone!</p>
              </div>
              <div style="margin-top: 30px; display: none;" class="screen-only">
                <button class="print-btn" onclick="window.print()">🖨️ Print QR Code</button>
                <button class="print-btn" onclick="window.close()">✕ Close</button>
              </div>
            </div>
            <script>
              // Show print buttons on screen
              document.querySelector('.screen-only').style.display = 'block';
              
              // Wait for image to load, then auto-print
              const img = document.querySelector('.qr-image');
              if (img.complete) {
                setTimeout(() => window.print(), 100);
              } else {
                img.onload = () => {
                  setTimeout(() => window.print(), 100);
                };
                img.onerror = () => {
                  console.error('QR Code image failed to load');
                };
              }
            </script>
          </body>
        </html>
      `;
      
      printWindow.document.write(printHTML);
      printWindow.document.close();
      
    } catch (error) {
      console.error('Print QR error:', error);
      
      // Enhanced fallback options
      const errorMessage = error instanceof Error ? error.message : 'Unknown print error';
      
      if (window.confirm(`Print Error: ${errorMessage}\n\nWould you like to download the QR code instead?`)) {
        // Fallback to download
        downloadQR();
      }
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
              onClick={printQR} 
              variant="outlined"
              startIcon={<Print />}
              sx={{ px: 3 }}
            >
              Print QR Code
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
