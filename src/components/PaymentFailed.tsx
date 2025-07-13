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
  Error,
  ArrowBack,
  Refresh,
  PhotoLibrary,
  ContactSupport
} from '@mui/icons-material';
import { getEvent } from '../services/photoService';
import { Event } from '../types';

const PaymentFailed: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const eventId = searchParams.get('event_id');
  const reason = searchParams.get('reason') || 'Unknown error';

  useEffect(() => {
    const loadEventData = async () => {
      if (!eventId) {
        console.error('❌ PaymentFailed: No event_id in URL parameters');
        setError('Event ID not found in URL');
        setLoading(false);
        return;
      }

      console.log('🔍 PaymentFailed: Loading event data for ID:', eventId);

      try {
        const eventData = await getEvent(eventId);
        console.log('📊 PaymentFailed: Event data loaded:', eventData);
        
        if (eventData) {
          setEvent(eventData);
          console.log('✅ PaymentFailed: Event loaded successfully:', eventData.title);
        } else {
          console.error('❌ PaymentFailed: Event not found for ID:', eventId);
          setError(`Event not found (ID: ${eventId})`);
        }
      } catch (catchError) {
        console.error('❌ PaymentFailed: Failed to load event:', catchError);
        setError('Failed to load event data: ' + String(catchError));
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
        <Error 
          sx={{ 
            fontSize: 80, 
            color: 'error.main', 
            mb: 2
          }} 
        />
        <Typography variant="h3" gutterBottom color="error.main" sx={{ fontWeight: 600 }}>
          Payment Failed
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
          We encountered an issue processing your payment.
        </Typography>
      </Box>

      {/* Error Details Card */}
      <Card elevation={3} sx={{ mb: 4, borderRadius: 3, borderColor: 'error.main', borderWidth: 1, borderStyle: 'solid' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
            <PhotoLibrary sx={{ mr: 1, color: 'primary.main' }} />
            {event?.title || 'Event Gallery'}
          </Typography>
          
          <Alert severity="error" sx={{ my: 3 }}>
            <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
              Payment Error Details:
            </Typography>
            <Typography variant="body2">
              {reason}
            </Typography>
          </Alert>

          <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
            Common Solutions:
          </Typography>
          
          <Box component="ul" sx={{ pl: 2, m: 0, mb: 3 }}>
            <Typography component="li" variant="body1" sx={{ mb: 1 }}>
              💳 Check that your card details are correct
            </Typography>
            <Typography component="li" variant="body1" sx={{ mb: 1 }}>
              💰 Ensure you have sufficient funds available
            </Typography>
            <Typography component="li" variant="body1" sx={{ mb: 1 }}>
              🌐 Try a different payment method or card
            </Typography>
            <Typography component="li" variant="body1" sx={{ mb: 1 }}>
              📱 Contact your bank if the issue persists
            </Typography>
          </Box>

          <Alert severity="info">
            <Typography variant="body2">
              Don't worry! Your event gallery is still active on the free plan. You can try upgrading again anytime.
            </Typography>
          </Alert>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleTryAgain}
          startIcon={<Refresh />}
          sx={{ 
            px: 4, 
            py: 1.5,
            fontWeight: 600,
            background: 'linear-gradient(45deg, #d81b60, #8e24aa)',
            '&:hover': {
              background: 'linear-gradient(45deg, #c2185b, #7b1fa2)',
            }
          }}
        >
          Try Payment Again
        </Button>
        
        <Button
          variant="outlined"
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
      </Box>

      {/* Support Section */}
      <Card elevation={2} sx={{ mt: 4, bgcolor: 'grey.50', borderRadius: 3 }}>
        <CardContent sx={{ p: 3, textAlign: 'center' }}>
          <ContactSupport sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Still having trouble?
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            Our support team is here to help with payment issues.
          </Typography>
          <Button
            variant="outlined"
            href={`mailto:support@socialboostai.com?subject=Payment Issue - Event: ${event?.title || eventId}`}
            startIcon={<ContactSupport />}
            sx={{ fontWeight: 600 }}
          >
            Contact Support
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
};

export default PaymentFailed;
