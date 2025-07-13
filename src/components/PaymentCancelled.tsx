import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Cancel,
  ArrowBack,
  Star,
  PhotoLibrary
} from '@mui/icons-material';
import { getEvent } from '../services/photoService';
import { Event } from '../types';

const PaymentCancelled: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const eventId = searchParams.get('event_id');

  useEffect(() => {
    const loadEventData = async () => {
      if (!eventId) {
        console.error('❌ PaymentCancelled: No event_id in URL parameters');
        setError('Event ID not found in URL');
        setLoading(false);
        return;
      }

      console.log('🔍 PaymentCancelled: Loading event data for ID:', eventId);

      try {
        const eventData = await getEvent(eventId);
        console.log('📊 PaymentCancelled: Event data loaded:', eventData);
        
        if (eventData) {
          setEvent(eventData);
          console.log('✅ PaymentCancelled: Event loaded successfully:', eventData.title);
        } else {
          console.error('❌ PaymentCancelled: Event not found for ID:', eventId);
          setError(`Event not found (ID: ${eventId})`);
        }
      } catch (error) {
        console.error('❌ PaymentCancelled: Failed to load event:', error);
        setError('Failed to load event data: ' + String(error));
      } finally {
        setLoading(false);
      }
    };

    loadEventData();
  }, [eventId]);

  const handleReturnToGallery = () => {
    if (eventId) {
      navigate(`/event/${eventId}`);
    } else {
      navigate('/');
    }
  };

  const handleTryAgain = () => {
    if (eventId) {
      // Navigate back to the event page where they can try upgrading again
      navigate(`/event/${eventId}`);
    } else {
      navigate('/');
    }
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} sx={{ mb: 2 }} />
        <Typography variant="h6" color="text.secondary">
          Loading event details...
        </Typography>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Error Loading Event
          </Typography>
          <Typography variant="body1">
            {error}
          </Typography>
        </Alert>
        <Button
          variant="outlined"
          onClick={() => {
            if (eventId) {
              navigate(`/event/${eventId}`);
            } else {
              navigate('/');
            }
          }}
          fullWidth
        >
          {eventId ? 'Go to Event Gallery' : 'Go to Home'}
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box textAlign="center" mb={4}>
        <Cancel 
          sx={{ 
            fontSize: 80, 
            color: 'warning.main', 
            mb: 2
          }} 
        />
        <Typography variant="h3" gutterBottom color="warning.main" sx={{ fontWeight: 600 }}>
          Payment Cancelled
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
          No worries! You can upgrade to premium anytime.
        </Typography>
      </Box>

      {/* Event Details Card */}
      <Card elevation={3} sx={{ mb: 4, borderRadius: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
            <PhotoLibrary sx={{ mr: 1, color: 'primary.main' }} />
            {event?.title || 'Event Gallery'}
          </Typography>
          
          <Alert severity="info" sx={{ my: 3 }}>
            <Typography variant="body1">
              Your event gallery is still active! You're currently on the free plan with a limit of {event?.photoLimit || 20} photos.
            </Typography>
          </Alert>

          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            When you're ready to upgrade, you'll get:
          </Typography>
          
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            <Typography component="li" variant="body1" sx={{ mb: 1 }}>
              ✨ Unlimited photo and video uploads
            </Typography>
            <Typography component="li" variant="body1" sx={{ mb: 1 }}>
              ✨ Custom branding options
            </Typography>
            <Typography component="li" variant="body1" sx={{ mb: 1 }}>
              ✨ Priority customer support
            </Typography>
            <Typography component="li" variant="body1">
              ✨ Enhanced gallery features
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleReturnToGallery}
          startIcon={<ArrowBack />}
          sx={{ 
            px: 4, 
            py: 1.5,
            fontWeight: 600
          }}
        >
          Return to Gallery
        </Button>
        
        <Button
          variant="outlined"
          size="large"
          onClick={handleTryAgain}
          startIcon={<Star />}
          sx={{ 
            px: 4, 
            py: 1.5,
            fontWeight: 600,
            borderColor: 'primary.main',
            color: 'primary.main',
            '&:hover': {
              borderColor: 'primary.dark',
              backgroundColor: 'primary.50'
            }
          }}
        >
          Try Upgrade Again
        </Button>
      </Box>

      {/* Support Note */}
      <Box textAlign="center" sx={{ mt: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Need help? Contact us at{' '}
          <Typography 
            component="a" 
            href="mailto:support@socialboostai.com"
            sx={{ 
              color: 'primary.main',
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' }
            }}
          >
            support@socialboostai.com
          </Typography>
        </Typography>
      </Box>
    </Container>
  );
};

export default PaymentCancelled;
