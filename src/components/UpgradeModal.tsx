import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import {
  Star,
  PhotoLibrary,
  Palette,
  CheckCircle,
  Close,
  Payment
} from '@mui/icons-material';
import { UpgradeModalProps } from '../types';
import { getEvent } from '../services/photoService';
import { sendUpgradeToGHL } from '../services/ghlService';

const UpgradeModal: React.FC<UpgradeModalProps> = ({
  open,
  onClose,
  eventId,
  currentPhotoCount,
  onUpgradeSuccess
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get event details
      const event = await getEvent(eventId);
      if (!event) {
        throw new Error('Event not found');
      }

      console.log('🔄 UpgradeModal: Storing event data in localStorage before payment redirect');
      
      // Always store fresh event data in localStorage (overwrite any existing data)
      const upgradeData = {
        eventId,
        eventTitle: event.title,
        organizerEmail: event.organizerEmail,
        organizerName: event.organizerEmail.split('@')[0],
        timestamp: Date.now(), // Fresh timestamp for each upgrade attempt
        paymentAmount: 29
      };
      
      // Always set localStorage, even if it already exists (handle multiple upgrade attempts)
      localStorage.setItem('pendingUpgrade', JSON.stringify(upgradeData));
      console.log('✅ UpgradeModal: Fresh event data stored in localStorage:', upgradeData);
      console.log('📝 UpgradeModal: This will be available for 5 minutes after payment success');

      // 🔥 CRITICAL FIX: Send upgrade data to GHL FIRST before payment redirect
      console.log('📤 UpgradeModal: Sending upgrade data to GHL inbound webhook...');
      const ghlSuccess = await sendUpgradeToGHL({
        eventId,
        eventTitle: event.title,
        organizerEmail: event.organizerEmail,
        organizerName: event.organizerEmail.split('@')[0],
        planType: 'premium',
        paymentAmount: 29,
        paymentId: `${eventId}_${Date.now()}`,
        paymentMethod: 'external_form'
      });

      if (ghlSuccess) {
        console.log('✅ UpgradeModal: GHL webhook data sent successfully - inbound webhook will have event data');
      } else {
        console.warn('⚠️ UpgradeModal: GHL webhook failed, but continuing with payment - will need manual upgrade');
      }

      // Create payment URL with event data
      const paymentBaseUrl = 'https://socialboostai.com/premium-upgrade-page';
      const params = new URLSearchParams({
        event_id: eventId,
        event_title: event.title,
        organizer_email: event.organizerEmail,
        organizer_name: event.organizerEmail.split('@')[0],
        amount: '29'
      });

      const paymentLink = `${paymentBaseUrl}?${params.toString()}`;
      
      console.log('🔗 UpgradeModal: Redirecting to payment page:', paymentLink);
      
      // Redirect to payment page in same tab
      window.location.href = paymentLink;

    } catch (error) {
      console.error('❌ UpgradeModal: Upgrade failed:', error);
      setError(error instanceof Error ? error.message : 'Upgrade failed');
      setLoading(false);
    }
  };

  const premiumFeatures = [
    {
      icon: <PhotoLibrary color="primary" />,
      title: 'Unlimited Photos & Videos',
      description: 'No more 20 photo limit - upload as many memories as you want!'
    },
    {
      icon: <Palette color="primary" />,
      title: 'Custom Branding',
      description: 'Add your logo and custom colors to make the gallery yours'
    },
    {
      icon: <CheckCircle color="primary" />,
      title: 'Priority Support',
      description: 'Get help when you need it with premium support'
    }
  ];

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="sm" 
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3 }
      }}
    >
      <DialogTitle sx={{ textAlign: 'center', pb: 1 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Star sx={{ color: 'primary.main', fontSize: 30 }} />
          <Typography variant="h5" component="div" sx={{ fontWeight: 600 }}>
            Upgrade to Premium
          </Typography>
          <Button 
            onClick={onClose} 
            size="small" 
            sx={{ minWidth: 'auto', p: 0.5 }}
          >
            <Close />
          </Button>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {/* Photo Limit Alert */}
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="body2">
            <strong>Photo limit reached!</strong> You've uploaded {currentPhotoCount}/2 photos. 
            Upgrade to premium for unlimited uploads.
          </Typography>
        </Alert>

        {/* Premium Features */}
        <Typography variant="h6" gutterBottom sx={{ mb: 2, textAlign: 'center' }}>
          What you get with Premium:
        </Typography>

        <List sx={{ mb: 3 }}>
          {premiumFeatures.map((feature, index) => (
            <ListItem key={index} sx={{ pl: 0 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                {feature.icon}
              </ListItemIcon>
              <ListItemText
                primary={feature.title}
                secondary={feature.description}
                primaryTypographyProps={{ fontWeight: 600 }}
              />
            </ListItem>
          ))}
        </List>

        {/* Pricing Card */}
        <Card 
          variant="outlined" 
          sx={{ 
            textAlign: 'center', 
            bgcolor: 'primary.main', 
            color: 'white',
            mb: 2
          }}
        >
          <CardContent sx={{ py: 2 }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              $29
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              One-time payment per event
            </Typography>
            <Chip 
              label="Best Value" 
              size="small" 
              sx={{ 
                mt: 1,
                bgcolor: 'secondary.main',
                color: 'white'
              }} 
            />
          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button 
          onClick={onClose} 
          variant="outlined"
          fullWidth
          sx={{ mr: 1 }}
        >
          Maybe Later
        </Button>
        <Button
          onClick={handleUpgrade}
          variant="contained"
          fullWidth
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : <Payment />}
          sx={{ 
            py: 1.5,
            fontWeight: 600
          }}
        >
          {loading ? 'Processing...' : 'Upgrade Now - $29'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UpgradeModal;
