// Where the customer lands after paying.
//
// What was wrong with it
// ----------------------
// Two things, both of which hit people at the worst possible moment.
//
// 1. It announced success on arrival. "Payment Successful! Welcome to Premium!
//    Your unlimited photo gallery is now active" rendered as soon as the page
//    loaded — but returning here only means the customer finished the order
//    form. The upgrade is written by `ghl-webhook` when GoHighLevel confirms the
//    transaction, and that is an independent race the redirect usually wins. So
//    a customer could read "now active", go back to the gallery, and find
//    uploads still closed. Then they email support about a payment that was
//    fine.
//
// 2. When it could not identify the event it showed them this:
//
//      Event ID not found. Debug info:
//      - URL event_id: null
//      - localStorage data: Not found
//
//    That is what a paying customer saw. And it happened for a predictable
//    reason: the event id was carried in localStorage, written just before the
//    redirect, so paying on a different device from the one that opened the
//    gallery — phone scans the QR, laptop pays — lost it entirely.
//
// Now: the event travels in a signed `ref` in the URL, and the page polls until
// the plan actually flips, saying something honest while it waits.
//
// Refs: AUDIT_2026-08.md GHL-2, UX-7

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
import { CheckCircle, HourglassTop, PhotoLibrary, ArrowForward } from '@mui/icons-material';
import { getCheckoutStatus } from '../services/checkoutService';
import { getEvent } from '../services/photoService';

// The webhook normally lands within a couple of seconds. We keep asking for a
// while longer because the alternative — telling someone their payment did not
// work when it did — is far more expensive than a few extra requests.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;

type Phase = 'checking' | 'upgraded' | 'pending' | 'unknown';

const PaymentSuccess: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const ref = searchParams.get('ref');
  // Links created before checkout-start existed carry a bare event_id. Honour
  // them: galleries are publicly readable, so the plan state can still be polled.
  const legacyEventId = (() => {
    const value = searchParams.get('event_id');
    return value && value !== '{event_id}' ? value : null;
  })();

  const [phase, setPhase] = useState<Phase>('checking');
  const [eventId, setEventId] = useState<string | null>(legacyEventId);
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const checkOnce = useCallback(async (): Promise<boolean> => {
    if (ref) {
      const status = await getCheckoutStatus(ref);
      if (!status) return false;

      setEventId(status.eventId);
      setEventTitle(status.eventTitle);
      return status.upgraded;
    }

    if (legacyEventId) {
      const event = await getEvent(legacyEventId);
      if (!event) return false;

      setEventTitle(event.title);
      return event.planType === 'premium';
    }

    return false;
  }, [ref, legacyEventId]);

  useEffect(() => {
    if (!ref && !legacyEventId) {
      setPhase('unknown');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const run = async (attempt: number) => {
      if (cancelled) return;

      let upgraded = false;
      try {
        upgraded = await checkOnce();
      } catch {
        // A failed poll is not a failed payment. Keep trying.
      }

      if (cancelled) return;

      if (upgraded) {
        setPhase('upgraded');
        return;
      }

      if (attempt >= MAX_POLLS) {
        setPhase('pending');
        return;
      }

      setAttempts(attempt + 1);
      timer = setTimeout(() => run(attempt + 1), POLL_INTERVAL_MS);
    };

    run(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ref, legacyEventId, checkOnce]);

  const goToGallery = () => navigate(eventId ? `/event/${eventId}` : '/');

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, sm: 10 } }}>
      <Card elevation={0} sx={{ borderRadius: 4, border: '1px solid', borderColor: 'grey.200' }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center' }}>
          {phase === 'checking' && (
            <>
              <CircularProgress size={56} sx={{ mb: 3 }} />
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                Confirming your payment
              </Typography>
              <Typography variant="body1" color="text.secondary">
                This usually takes a few seconds. You can leave this page open.
              </Typography>
              {attempts > 4 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Still working — payment confirmations occasionally take a little longer.
                </Typography>
              )}
            </>
          )}

          {phase === 'upgraded' && (
            <>
              <CheckCircle sx={{ fontSize: 72, color: 'success.main', mb: 2 }} />
              <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
                You're all set
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
                {eventTitle ? (
                  <>
                    Uploads are open again for <strong>{eventTitle}</strong>, and will stay open.
                  </>
                ) : (
                  'Uploads are open again, and will stay open.'
                )}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                Share the gallery link or QR code with your guests — anything they add from now on
                appears straight away.
              </Typography>

              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={goToGallery}
                endIcon={<ArrowForward />}
                sx={{ py: 1.5, textTransform: 'none', fontWeight: 600 }}
              >
                Back to the gallery
              </Button>
            </>
          )}

          {phase === 'pending' && (
            <>
              {/*
                The honest state. The payment almost certainly succeeded — we
                simply have not seen the confirmation yet. Nothing here should
                read as an error, because for the customer nothing has gone
                wrong, and telling them otherwise generates a support email about
                a working payment.
              */}
              <HourglassTop sx={{ fontSize: 72, color: 'warning.main', mb: 2 }} />
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                Payment received — finishing up
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
                Your upgrade is taking a little longer than usual to apply. It normally completes
                within a few minutes.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                Nothing else is needed from you. If the gallery still shows uploads as closed in an
                hour, forward your receipt to{' '}
                <Box component="a" href="mailto:support@socialboostai.com" sx={{ color: 'inherit' }}>
                  support@socialboostai.com
                </Box>{' '}
                and we'll sort it out.
              </Typography>

              <Stack spacing={1}>
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  onClick={goToGallery}
                  sx={{ py: 1.5, textTransform: 'none', fontWeight: 600 }}
                >
                  Back to the gallery
                </Button>
                <Button
                  fullWidth
                  onClick={() => window.location.reload()}
                  sx={{ textTransform: 'none' }}
                >
                  Check again
                </Button>
              </Stack>
            </>
          )}

          {phase === 'unknown' && (
            <>
              {/*
                Reached when the link carries no usable reference — most often an
                expired one, since refs last 24 hours. This is emphatically not a
                statement about whether the payment worked, and must not read as
                one.
              */}
              <PhotoLibrary sx={{ fontSize: 72, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                This link has expired
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
                If you completed a payment, it went through — open your gallery to check, or reply
                to your receipt email and we'll confirm it for you.
              </Typography>

              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={() => navigate('/')}
                sx={{ py: 1.5, textTransform: 'none', fontWeight: 600 }}
              >
                Go to SharedMoments
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </Container>
  );
};

export default PaymentSuccess;
