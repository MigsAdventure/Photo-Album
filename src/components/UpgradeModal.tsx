// The upgrade modal.
//
// What was wrong with it
// ----------------------
// It sold a product that no longer existed. The headline alert read "Photo limit
// reached! You've uploaded {n}/2 photos" and the first feature bullet promised
// "No more 20 photo limit" — two different dead numbers in one dialog, both left
// over from the count-based paywall UX-1 removed. A customer reading this could
// not tell what they were buying, and neither number described anything the
// software actually did.
//
// It also did the work of a payment backend from the browser: fabricated a
// payment id, told the CRM the upgrade had completed, and assembled the checkout
// URL with the price in a query parameter — all before the customer saw a form.
// That moved to netlify/functions/checkout-start.js.
//
// What it says now: uploads run on a window, here is when yours closes (or that
// it has), and upgrading reopens it permanently. The price comes from the server
// so the number shown is the number charged.
//
// Refs: AUDIT_2026-08.md UX-1, GHL-2

import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Alert,
  IconButton,
} from '@mui/material';
import {
  AllInclusive,
  LockOpen,
  CloudDownload,
  Palette,
  Close,
  ArrowForward,
} from '@mui/icons-material';
import { UpgradeModalProps } from '../types';
import {
  startCheckout,
  NotOrganizerError,
  AlreadyPremiumError,
  CheckoutSession,
} from '../services/checkoutService';

const PREMIUM_FEATURES = [
  {
    icon: <LockOpen color="primary" />,
    title: 'Uploads stay open',
    description: 'Guests can keep adding photos and videos indefinitely, with no closing date.',
  },
  {
    icon: <AllInclusive color="primary" />,
    title: 'No limits on the gallery',
    description: 'Every photo and video from the day, at full quality.',
  },
  {
    icon: <CloudDownload color="primary" />,
    title: 'Download everything, any time',
    description: 'Request the full album whenever you like — it never expires.',
  },
  {
    icon: <Palette color="primary" />,
    title: 'Make it yours',
    description: 'Add your own cover photo and colours to the gallery.',
  },
];

const UpgradeModal: React.FC<UpgradeModalProps> = ({ open, onClose, eventId, onUpgradeSuccess }) => {
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  // The parent passes these as inline arrows, so they get a new identity on every
  // one of its renders. Holding them in refs keeps them out of the effect's
  // dependencies below — see the note there for why that matters here
  // specifically.
  const onCloseRef = useRef(onClose);
  const onUpgradeSuccessRef = useRef(onUpgradeSuccess);

  useEffect(() => {
    onCloseRef.current = onClose;
    onUpgradeSuccessRef.current = onUpgradeSuccess;
  });

  // Fetch the offer when the dialog opens, so the price and the closing date are
  // on screen before the customer decides — rather than being discovered on the
  // payment page. This also surfaces "you are not the organizer" here, instead of
  // after a redirect to a form they cannot complete.
  //
  // This must run once per opening, and nothing else. `onClose` and
  // `onUpgradeSuccess` were in the dependency array, which looked correct and was
  // not: the parent supplies them as inline arrows, and EnhancedPhotoGallery
  // re-renders on every Firestore photo update because the gallery is live. So
  // with the modal open during an actual event, every photo a guest uploaded
  // re-ran this — issuing a fresh checkout reference and posting another
  // `checkout_started` to the CRM each time. Which is the same category of defect
  // as the pre-payment CRM call this whole change set removed.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const load = async () => {
      setLoadingOffer(true);
      setError(null);
      setNeedsSignIn(false);

      try {
        const result = await startCheckout(eventId);
        if (!cancelled) setSession(result);
      } catch (err) {
        if (cancelled) return;

        if (err instanceof AlreadyPremiumError) {
          onUpgradeSuccessRef.current();
          onCloseRef.current();
          return;
        }

        if (err instanceof NotOrganizerError) {
          setNeedsSignIn(true);
          setError(err.message);
          return;
        }

        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      } finally {
        if (!cancelled) setLoadingOffer(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  const handleUpgrade = () => {
    if (!session) return;
    setRedirecting(true);
    window.location.href = session.checkoutUrl;
  };

  const closesAtText = (() => {
    if (!session?.closesAt) return null;

    const closesAt = new Date(session.closesAt);
    if (Number.isNaN(closesAt.getTime())) return null;

    return closesAt.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  })();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}
    >
      <Box sx={{ position: 'relative', pt: 4, pb: 1, px: 3, textAlign: 'center' }}>
        <IconButton
          onClick={onClose}
          size="small"
          aria-label="Close"
          sx={{ position: 'absolute', top: 8, right: 8 }}
        >
          <Close fontSize="small" />
        </IconButton>

        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Keep this gallery open
        </Typography>

        {/*
          The state, in one sentence, before any sales copy. A customer who
          arrived here from "uploads have closed" needs to know that is what they
          are fixing; one who is still inside their window needs to know they are
          not in trouble yet.
        */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {session?.uploadsClosed
            ? 'Uploads have closed for this event. Upgrading reopens them right away.'
            : closesAtText
              ? `Free uploads close on ${closesAtText}. Upgrading keeps them open for good.`
              : 'Upgrading keeps uploads open for good.'}
        </Typography>
      </Box>

      <DialogContent sx={{ pt: 1 }}>
        {error && (
          <Alert severity={needsSignIn ? 'info' : 'error'} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <List dense sx={{ mb: 1 }}>
          {PREMIUM_FEATURES.map((feature) => (
            <ListItem key={feature.title} sx={{ pl: 0, alignItems: 'flex-start' }}>
              <ListItemIcon sx={{ minWidth: 40, mt: 0.5 }}>{feature.icon}</ListItemIcon>
              <ListItemText
                primary={feature.title}
                secondary={feature.description}
                primaryTypographyProps={{ fontWeight: 600, variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'body2' }}
              />
            </ListItem>
          ))}
        </List>

        <Box
          sx={{
            textAlign: 'center',
            py: 2,
            borderRadius: 2,
            bgcolor: 'grey.50',
            border: '1px solid',
            borderColor: 'grey.200',
          }}
        >
          {loadingOffer ? (
            <CircularProgress size={24} />
          ) : (
            <>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {session?.offer.display ?? '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                One payment for this event. No subscription.
              </Typography>
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, flexDirection: 'column', gap: 1 }}>
        <Button
          onClick={handleUpgrade}
          variant="contained"
          fullWidth
          size="large"
          disabled={!session || loadingOffer || redirecting}
          endIcon={redirecting ? <CircularProgress size={18} color="inherit" /> : <ArrowForward />}
          sx={{ py: 1.5, fontWeight: 600, textTransform: 'none' }}
        >
          {redirecting
            ? 'Taking you to checkout…'
            : session
              ? `Continue — ${session.offer.display}`
              : 'Continue'}
        </Button>

        <Button onClick={onClose} fullWidth sx={{ textTransform: 'none' }}>
          Not now
        </Button>

        {/*
          Said plainly, because leaving the site to pay is the moment people
          abandon. Knowing they come back to the gallery removes the worry that
          they are about to lose their place.
        */}
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          You'll pay on our secure checkout page and come straight back here.
        </Typography>
      </DialogActions>
    </Dialog>
  );
};

export default UpgradeModal;
