// Shown when someone backs out of checkout.
//
// This is the least alarming of the three return pages and had the most alarming
// copy: it told customers they were "on the free plan with a limit of
// {photoLimit || 20} photos". There is no photo limit — UX-1 replaced the count
// with an upload window — and the number was wrong twice over, since the field
// was written as 2 at creation, so the 20 fallback only ever showed when the
// data was missing.
//
// It also resolved the event through `localStorage.pendingUpgrade`, which does
// not survive paying on a second device. That is now the shared resolver.
//
// Refs: AUDIT_2026-08.md UX-1, UX-7

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  CircularProgress,
  Stack,
} from '@mui/material';
import { ArrowBack, Star } from '@mui/icons-material';
import { useCheckoutEvent } from '../services/paymentReturn';

const PaymentCancelled: React.FC = () => {
  const navigate = useNavigate();
  const { eventId, eventTitle, loading } = useCheckoutEvent();

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
        <CircularProgress size={48} />
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, sm: 10 } }}>
      <Card elevation={0} sx={{ borderRadius: 4, border: '1px solid', borderColor: 'grey.200' }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
            No problem — nothing was charged
          </Typography>

          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {eventTitle ? (
              <>
                <strong>{eventTitle}</strong> is exactly as you left it. Guests can still upload,
                and everything already in the gallery stays there.
              </>
            ) : (
              'Your gallery is exactly as you left it. Guests can still upload, and everything already in it stays there.'
            )}
          </Typography>

          <Box
            sx={{
              textAlign: 'left',
              p: 2.5,
              mb: 3,
              borderRadius: 2,
              bgcolor: 'grey.50',
              border: '1px solid',
              borderColor: 'grey.200',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              If you upgrade later, you get:
            </Typography>
            <Typography variant="body2" color="text.secondary" component="ul" sx={{ pl: 2, m: 0 }}>
              <li>Uploads that stay open, with no closing date</li>
              <li>Every photo and video at full quality</li>
              <li>Full-album downloads whenever you want them</li>
              <li>Your own cover photo and colours on the gallery</li>
            </Typography>
          </Box>

          <Stack spacing={1}>
            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={<ArrowBack />}
              onClick={() => navigate(eventId ? `/event/${eventId}` : '/')}
              sx={{ py: 1.5, textTransform: 'none', fontWeight: 600 }}
            >
              {eventId ? 'Back to the gallery' : 'Go to SharedMoments'}
            </Button>

            {eventId && (
              <Button
                fullWidth
                startIcon={<Star />}
                onClick={() => navigate(`/event/${eventId}`)}
                sx={{ textTransform: 'none' }}
              >
                Change your mind? Upgrade from the gallery
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
};

export default PaymentCancelled;
