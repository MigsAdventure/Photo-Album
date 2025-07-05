import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate } from 'react-router-dom';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Container,
  Typography,
  TextField,
  Button,
  Paper,
  Box,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Card,
  CardContent
} from '@mui/material';
import {
  PhotoCamera,
  QrCode,
  PhoneAndroid,
  CloudUpload,
  CheckCircle,
  Home,
  Visibility
} from '@mui/icons-material';
import PhotoGallery from './components/PhotoGallery';
import QRCodeDisplay from './components/QRCodeDisplay';
import BottomNavbar from './components/BottomNavbar';
import { createWedding, getWedding, subscribeToPhotos } from './services/photoService';
import { Wedding, Photo } from './types';

// Create a wedding-themed Material UI theme
const theme = createTheme({
  palette: {
    primary: {
      main: '#d81b60', // Pink
      light: '#ff5983',
      dark: '#a00037',
    },
    secondary: {
      main: '#8e24aa', // Purple
      light: '#c158dc',
      dark: '#5e0a87',
    },
    background: {
      default: '#fafafa',
      paper: '#ffffff',
    },
  },
  typography: {
    h1: {
      fontWeight: 300,
      fontSize: '2.5rem',
    },
    h2: {
      fontWeight: 400,
      fontSize: '2rem',
    },
  },
  shape: {
    borderRadius: 12,
  },
});

// Admin Dashboard - Create new wedding
const AdminDashboard: React.FC = () => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [wedding, setWedding] = useState<Wedding | null>(null);
  const navigate = useNavigate();

  const handleCreateWedding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !date) return;

    setLoading(true);
    try {
      const weddingId = await createWedding(title, date);
      const newWedding: Wedding = {
        id: weddingId,
        title,
        date,
        createdAt: new Date(),
        isActive: true
      };
      setWedding(newWedding);
    } catch (error) {
      console.error('Failed to create wedding:', error);
      alert('Failed to create wedding. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const goToGuestView = () => {
    if (wedding) {
      navigate(`/wedding/${wedding.id}`);
    }
  };

  if (wedding) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box textAlign="center" mb={4}>
          <Typography variant="h1" gutterBottom color="primary">
            Wedding Created Successfully! 🎉
          </Typography>
        </Box>
        
        <QRCodeDisplay weddingId={wedding.id} title={wedding.title} />
        
        <Box textAlign="center" mt={4}>
          <Button
            variant="contained"
            size="large"
            onClick={goToGuestView}
            startIcon={<Visibility />}
            sx={{ px: 4, py: 1.5 }}
          >
            View Guest Gallery
          </Button>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper elevation={3} sx={{ p: 4, borderRadius: 3 }}>
        <Box textAlign="center" mb={4}>
          <PhotoCamera sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
          <Typography variant="h1" gutterBottom color="primary">
            Wedding Photo Sharing
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Create a photo gallery for your special day
          </Typography>
        </Box>

        <Box component="form" onSubmit={handleCreateWedding} sx={{ mb: 4 }}>
          <TextField
            fullWidth
            label="Wedding Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Sarah & John's Wedding"
            required
            sx={{ mb: 3 }}
          />

          <TextField
            fullWidth
            label="Wedding Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 3 }}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <CloudUpload />}
            sx={{ py: 1.5 }}
          >
            {loading ? 'Creating...' : 'Create Wedding Gallery'}
          </Button>
        </Box>

        <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom color="primary">
              What you'll get:
            </Typography>
            <List dense>
              {[
                { icon: <QrCode />, text: 'QR code for easy guest access' },
                { icon: <CloudUpload />, text: 'Real-time photo uploads' },
                { icon: <PhoneAndroid />, text: 'Mobile-optimized interface' },
                { icon: <CheckCircle />, text: 'Unlimited photo sharing' }
              ].map((feature, index) => (
                <ListItem key={index} sx={{ pl: 0 }}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {React.cloneElement(feature.icon, { color: 'primary', fontSize: 'small' })}
                  </ListItemIcon>
                  <ListItemText primary={feature.text} />
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      </Paper>
    </Container>
  );
};

// Guest View - Upload and view photos
const GuestView: React.FC = () => {
  const { weddingId } = useParams<{ weddingId: string }>();
  const [wedding, setWedding] = useState<Wedding | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadWedding = async () => {
      if (!weddingId) {
        setError('Wedding ID not found');
        setLoading(false);
        return;
      }

      try {
        const weddingData = await getWedding(weddingId);
        if (weddingData) {
          setWedding(weddingData);
        } else {
          setError('Wedding not found');
        }
      } catch (error) {
        console.error('Failed to load wedding:', error);
        setError('Failed to load wedding');
      } finally {
        setLoading(false);
      }
    };

    loadWedding();
  }, [weddingId]);

  // Subscribe to photos for the bottom navbar
  useEffect(() => {
    if (!weddingId) return;

    const unsubscribe = subscribeToPhotos(weddingId, (newPhotos) => {
      setPhotos(newPhotos);
    });

    return () => unsubscribe();
  }, [weddingId]);

  const handleUploadComplete = () => {
    // Photos will automatically update via subscription
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} sx={{ mb: 2 }} />
        <Typography variant="h6" color="text.secondary">
          Loading wedding gallery...
        </Typography>
      </Container>
    );
  }

  if (error || !wedding || !weddingId) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Oops! 😅
          </Typography>
          <Typography variant="body1">
            {error || 'Wedding not found'}
          </Typography>
        </Alert>
        <Button
          variant="outlined"
          startIcon={<Home />}
          href="/"
          fullWidth
        >
          Go to Home
        </Button>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        sx={{
          background: 'linear-gradient(135deg, #d81b60 0%, #8e24aa 100%)',
          color: 'white',
          py: 4,
          textAlign: 'center'
        }}
      >
        <Container maxWidth="md">
          <Typography variant="h2" gutterBottom>
            {wedding.title}
          </Typography>
          <Typography variant="h6">
            {new Date(wedding.date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 4, pb: 12 }}>
        <PhotoGallery weddingId={weddingId} />
      </Container>

      {/* Bottom Navigation */}
      <BottomNavbar 
        photos={photos} 
        weddingId={weddingId} 
        onUploadComplete={handleUploadComplete} 
      />
    </Box>
  );
};

// Main App component
const App: React.FC = () => {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
          <Route path="/wedding/:weddingId" element={<GuestView />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export default App;
