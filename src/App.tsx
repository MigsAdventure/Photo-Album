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
import EnhancedPhotoGallery from './components/EnhancedPhotoGallery';
import QRCodeDisplay from './components/QRCodeDisplay';
import BottomNavbar from './components/BottomNavbar';
import { createEvent, getEvent, subscribeToPhotos } from './services/photoService';
import { Event, Photo } from './types';

// Create a celebration-themed Material UI theme
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

// Admin Dashboard - Create new event
const AdminDashboard: React.FC = () => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [event, setEvent] = useState<Event | null>(null);
  const navigate = useNavigate();

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !date) return;

    setLoading(true);
    try {
      const eventId = await createEvent(title, date);
      const newEvent: Event = {
        id: eventId,
        title,
        date,
        createdAt: new Date(),
        isActive: true
      };
      setEvent(newEvent);
    } catch (error) {
      console.error('Failed to create event:', error);
      alert('Failed to create event. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const goToGuestView = () => {
    if (event) {
      navigate(`/event/${event.id}`);
    }
  };

  if (event) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box textAlign="center" mb={4}>
          <Typography variant="h1" gutterBottom color="primary">
            Event Created Successfully! 🎉
          </Typography>
        </Box>
        
        <QRCodeDisplay eventId={event.id} title={event.title} />
        
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
            Shared Moments
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Capture and share memories from any celebration
          </Typography>
        </Box>

        <Box component="form" onSubmit={handleCreateEvent} sx={{ mb: 4 }}>
          <TextField
            fullWidth
            label="Event Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Sarah's Birthday Party, Company Picnic"
            required
            sx={{ mb: 3 }}
          />

          <TextField
            fullWidth
            label="Event Date"
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
            {loading ? 'Creating...' : 'Create Event Gallery'}
          </Button>
        </Box>

        <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom color="primary">
              Perfect for any celebration:
            </Typography>
            <List dense>
              {[
                { icon: <QrCode />, text: 'QR code for easy guest access' },
                { icon: <CloudUpload />, text: 'Real-time photo uploads' },
                { icon: <PhoneAndroid />, text: 'Perfect for any celebration' },
                { icon: <CheckCircle />, text: 'Weddings, birthdays, corporate events & more' }
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
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadEvent = async () => {
      if (!eventId) {
        setError('Event ID not found');
        setLoading(false);
        return;
      }

      try {
        const eventData = await getEvent(eventId);
        if (eventData) {
          setEvent(eventData);
        } else {
          setError('Event not found');
        }
      } catch (error) {
        console.error('Failed to load event:', error);
        setError('Failed to load event');
      } finally {
        setLoading(false);
      }
    };

    loadEvent();
  }, [eventId]);

  // Subscribe to photos for the bottom navbar
  useEffect(() => {
    if (!eventId) return;

    const unsubscribe = subscribeToPhotos(eventId, (newPhotos) => {
      setPhotos(newPhotos);
    });

    return () => unsubscribe();
  }, [eventId]);

  const handleUploadComplete = () => {
    // Photos will automatically update via subscription
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} sx={{ mb: 2 }} />
        <Typography variant="h6" color="text.secondary">
          Loading event gallery...
        </Typography>
      </Container>
    );
  }

  if (error || !event || !eventId) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Oops! 😅
          </Typography>
          <Typography variant="body1">
            {error || 'Event not found'}
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
            {event.title}
          </Typography>
          <Typography variant="h6">
            {new Date(event.date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 4, pb: 12 }}>
        <EnhancedPhotoGallery eventId={eventId} />
      </Container>

      {/* Bottom Navigation */}
      <BottomNavbar 
        photos={photos} 
        eventId={eventId} 
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
          <Route path="/event/:eventId" element={<GuestView />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export default App;
