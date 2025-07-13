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
  CircularProgress,
  Divider,
  Chip
} from '@mui/material';
import {
  CheckCircle,
  ArrowBack,
  Star,
  PhotoLibrary,
  Receipt
} from '@mui/icons-material';
import { getEvent } from '../services/photoService';
import { Event } from '../types';

const PaymentSuccess: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Try URL parameter first, then localStorage as fallback
  const getEventId = (): string | null => {
    const urlEventId = searchParams.get('event_id');
    if (urlEventId && urlEventId !== '{event_id}') {
      console.log('✅ PaymentSuccess: Got event_id from URL:', urlEventId);
      return urlEventId;
    }
    
    console.log('⚠️ PaymentSuccess: No valid event_id in URL, checking localStorage...');
    
    try {
      const pendingUpgradeData = localStorage.getItem('pendingUpgrade');
      if (pendingUpgradeData) {
        const upgradeData = JSON.parse(pendingUpgradeData);
        const isRecent = upgradeData.timestamp && (Date.now() - upgradeData.timestamp < 3600000); // 1 hour
        
        if (isRecent && upgradeData.eventId) {
          console.log('✅ PaymentSuccess: Got event_id from localStorage:', upgradeData.eventId);
          // Don't clear immediately - set a 5-minute cleanup timer instead
          setTimeout(() => {
            console.log('🧹 PaymentSuccess: Cleaning up localStorage after 5 minutes');
            localStorage.removeItem('pendingUpgrade');
          }, 5 * 60 * 1000); // 5 minutes
          return upgradeData.eventId;
        } else if (!isRecent) {
          console.log('⚠️ PaymentSuccess: localStorage data expired, clearing...');
          localStorage.removeItem('pendingUpgrade');
        }
      }
    } catch (error) {
      console.error('❌ PaymentSuccess: Error reading localStorage:', error);
      localStorage.removeItem('pendingUpgrade');
    }
    
    return null;
  };

  const eventId = getEventId();
  const orderId = searchParams.get('order_id');

  useEffect(() => {
    const loadEventData = async () => {
      console.log('🔍 PaymentSuccess: Starting event lookup process...');
      console.log('📍 Current URL:', window.location.href);
      console.log('📍 Search params:', window.location.search);
      
      if (!eventId) {
        console.error('❌ PaymentSuccess: No event_id found in URL or localStorage');
        
        // Add debugging info about what we tried
        const urlEventId = searchParams.get('event_id');
        console.log('🔗 URL event_id value:', urlEventId);
        
        const pendingUpgradeData = localStorage.getItem('pendingUpgrade');
        console.log('📦 localStorage pendingUpgrade:', pendingUpgradeData);
        
        setError(`Event ID not found. Debug info:
        - URL event_id: ${urlEventId}
        - localStorage data: ${pendingUpgradeData ? 'Found' : 'Not found'}
        Please return to your event gallery.`);
        setLoading(false);
        return;
      }

      console.log('🔍 PaymentSuccess: Loading event data for ID:', eventId);

      try {
        // Add test function call for debugging
        try {
          console.log('🧪 Testing event lookup via debug function...');
          const debugResponse = await fetch(`/.netlify/functions/test-event-lookup?eventId=${eventId}`);
          const debugData = await debugResponse.json();
          console.log('🧪 Debug lookup result:', debugData);
        } catch (debugError) {
          console.log('⚠️ Debug function failed (this is ok):', debugError instanceof Error ? debugError.message : String(debugError));
        }

        const eventData = await getEvent(eventId);
        console.log('📊 PaymentSuccess: Event data from getEvent():', eventData);
        
        if (eventData) {
          setEvent(eventData);
          console.log('✅ PaymentSuccess: Event loaded successfully:', eventData.title);
        } else {
          console.error('❌ PaymentSuccess: Event not found for ID:', eventId);
          setError(`Event not found in database. 
          Event ID: ${eventId}
          This event may have been deleted or the ID is incorrect.
          Please check with the event organizer.`);
        }
      } catch (error) {
        console.error('❌ PaymentSuccess: Failed to load event:', error);
        setError(`Failed to load event data: ${error instanceof Error ? error.message : String(error)}
        Event ID: ${eventId}
        Error details: ${String(error)}`);
      } finally {
        setLoading(false);
      }
    };

    loadEventData();
  }, [eventId, searchParams]);

  const handleReturnToGallery = () => {
    if (eventId) {
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
          Processing payment confirmation...
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
        <CheckCircle 
          sx={{ 
            fontSize: 80, 
            color: 'success.main', 
            mb: 2,
            animation: 'pulse 2s infinite'
          }} 
        />
        <Typography variant="h3" gutterBottom color="success.main" sx={{ fontWeight: 600 }}>
          Payment Successful! 🎉
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
          Welcome to Premium! Your unlimited photo gallery is now active.
        </Typography>
      </Box>

      {/* Event Details Card */}
      <Card elevation={3} sx={{ mb: 4, borderRadius: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
            <PhotoLibrary sx={{ mr: 1, color: 'primary.main' }} />
            {event?.title || 'Event Gallery'}
          </Typography>
          
          <Divider sx={{ my: 2 }} />
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                Plan Status:
              </Typography>
              <Chip
                icon={<Star />}
                label="Premium Plan"
                color="warning"
                sx={{
                  fontWeight: 'bold',
                  background: 'linear-gradient(45deg, #ffd700, #ffed4e)',
                  color: '#000',
                  '& .MuiChip-icon': { color: '#000' }
                }}
              />
            </Box>
            
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                Photo Limit:
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 600, color: 'success.main' }}>
                Unlimited Photos & Videos
              </Typography>
            </Box>
            
            {orderId && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" color="text.secondary">
                  Order ID:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', bgcolor: 'grey.100', px: 1, py: 0.5, borderRadius: 1 }}>
                  {orderId}
                </Typography>
              </Box>
            )}
            
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                Amount Paid:
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 600, color: 'success.main' }}>
                $29.00
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Premium Features Unlocked */}
      <Card elevation={2} sx={{ mb: 4, bgcolor: 'success.50', borderRadius: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ color: 'success.dark', display: 'flex', alignItems: 'center' }}>
            <Star sx={{ mr: 1 }} />
            Premium Features Now Active:
          </Typography>
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            <Typography component="li" variant="body1" sx={{ mb: 1, color: 'success.dark' }}>
              ✅ Unlimited photo and video uploads
            </Typography>
            <Typography component="li" variant="body1" sx={{ mb: 1, color: 'success.dark' }}>
              ✅ Custom branding options
            </Typography>
            <Typography component="li" variant="body1" sx={{ mb: 1, color: 'success.dark' }}>
              ✅ Priority customer support
            </Typography>
            <Typography component="li" variant="body1" sx={{ color: 'success.dark' }}>
              ✅ Enhanced gallery features
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleReturnToGallery}
          startIcon={<ArrowBack />}
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
          Return to Your Event Gallery
        </Button>
      </Box>

      {/* Receipt Note */}
      <Box textAlign="center" sx={{ mt: 4 }}>
        <Alert severity="info" sx={{ display: 'inline-flex', alignItems: 'center' }}>
          <Receipt sx={{ mr: 1 }} />
          A receipt has been sent to your email address for this transaction.
        </Alert>
      </Box>
    </Container>
  );
};

export default PaymentSuccess;
