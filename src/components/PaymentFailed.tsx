// Shown when a payment did not go through.
//
// What was wrong with it
// ----------------------
// 1. It rendered `?reason=` verbatim, inside an alert headed "Payment Error
//    Details" and styled as ours. Anyone could send a link that displayed
//    arbitrary text there under our branding — "your card was declined, call
//    this number to resolve it" being the obvious abuse. React escapes the
//    string, which prevents script injection and does nothing whatsoever about
//    the actual problem. Failure codes now map to copy we control.
//
// 2. It identified the event through `localStorage.pendingUpgrade`, so paying on
//    a different device from the one that opened the gallery lost it, and then
//    showed "Event ID not found" to someone whose card had just been declined.
//
// 3. Its error branch printed raw exception text (`'Failed to load event data: '
//    + String(catchError)`) to the customer.
//
// Refs: AUDIT_2026-08.md GHL-2, UX-7

import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  Alert,
  CircularProgress,
  Stack,
} from '@mui/material';
import { ErrorOutline, Refresh, ContactSupport } from '@mui/icons-material';
import { useCheckoutEvent, describeFailureReason } from '../services/paymentReturn';

const PaymentFailed: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { eventId, eventTitle, loading } = useCheckoutEvent();

  const reason = describeFailureReason(searchParams.get('reason'));

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
        <CircularProgress size={48} />
      </Container>
    );
  }

  const supportSubject = encodeURIComponent(
    `Payment issue${eventTitle ? ` — ${eventTitle}` : ''}`
  );

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, sm: 10 } }}>
      <Card elevation={0} sx={{ borderRadius: 4, border: '1px solid', borderColor: 'grey.200' }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center' }}>
          <ErrorOutline sx={{ fontSize: 72, color: 'error.main', mb: 2 }} />

          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
            That payment didn't go through
          </Typography>

          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {reason}
          </Typography>

          {/*
            The reassurance belongs high up, not buried under a list of
            troubleshooting steps. Someone whose card was just declined wants to
            know their gallery is fine before anything else.
          */}
          <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
            Your gallery is unaffected — it's still live and guests can still upload. You can try
            again whenever you like.
          </Alert>

          <Stack spacing={1}>
            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={<Refresh />}
              onClick={() => navigate(eventId ? `/event/${eventId}` : '/')}
              sx={{ py: 1.5, textTransform: 'none', fontWeight: 600 }}
            >
              {eventId ? 'Back to the gallery to try again' : 'Go to SharedMoments'}
            </Button>

            <Button
              fullWidth
              startIcon={<ContactSupport />}
              href={`mailto:support@socialboostai.com?subject=${supportSubject}`}
              sx={{ textTransform: 'none' }}
            >
              Email support
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
};

export default PaymentFailed;
