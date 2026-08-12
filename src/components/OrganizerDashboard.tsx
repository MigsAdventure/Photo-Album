// The organizer console (finding UX-2).
//
// Before this, creating an event returned a QR code and an email — and that was
// the entire relationship. There was no way to see your events, reopen one,
// check how many photos had come in, remove something a guest should not have
// posted, or download without the email round trip. Lose the email and the
// event was effectively gone, because nothing listed your events: nothing knew
// they were yours.
//
// For a planner running six events a season that was the single biggest gap
// between what existed and what someone would pay for monthly.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  CardActions,
  Chip,
  Stack,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Email,
  Logout,
  Visibility,
  ContentCopy,
  CalendarMonth,
  PhotoLibrary,
  LockOpen,
  Lock,
  Refresh,
} from '@mui/icons-material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Event } from '../types';
import {
  sendMagicLink,
  isMagicLink,
  completeMagicLinkSignIn,
  onAuthChange,
  signOut,
} from '../services/authService';
import { getUploadState, explainUploadState, describeTimeRemaining } from '../services/planService';

type Phase = 'checking' | 'signed-out' | 'link-sent' | 'needs-email' | 'signed-in';

const OrganizerDashboard: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ------------------------------------------------------------ sign-in

  // Completing a magic link has to happen before the auth listener settles,
  // otherwise the page renders the signed-out form for a moment and then
  // swaps — which reads as a failed sign-in.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (isMagicLink()) {
        setBusy(true);
        try {
          await completeMagicLinkSignIn();
          // Strip the link's credentials from the address bar so a shared or
          // bookmarked URL cannot be reused, and a refresh does not retry a
          // one-time code.
          window.history.replaceState({}, '', '/dashboard');
        } catch (err: any) {
          if (!cancelled) {
            if (err?.name === 'EmailRequiredError') {
              // The link was opened on a different device from the one that
              // requested it, so we do not have the address stored.
              setPhase('needs-email');
            } else {
              setError(err?.message || 'That sign-in link did not work');
              setPhase('signed-out');
            }
          }
        } finally {
          if (!cancelled) setBusy(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onAuthChange((user) => {
      if (user?.email) {
        setUserEmail(user.email.toLowerCase());
        setPhase('signed-in');
      } else {
        setUserEmail(null);
        setPhase((current) =>
          current === 'link-sent' || current === 'needs-email' ? current : 'signed-out'
        );
      }
    });
  }, []);

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      await sendMagicLink(email);
      setPhase('link-sent');
    } catch (err: any) {
      setError(err?.message || 'Could not send the sign-in link');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteWithEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      await completeMagicLinkSignIn(email);
      window.history.replaceState({}, '', '/dashboard');
    } catch (err: any) {
      setError(err?.message || 'That sign-in link did not work');
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------------- events

  const loadEvents = useCallback(async () => {
    if (!userEmail) return;

    setLoadingEvents(true);
    setError('');

    try {
      // The where clause is not optional. firestore.rules evaluates `list`
      // against the query rather than its results, so a query without it is
      // refused outright — which is what stops this listing every customer's
      // events.
      const snapshot = await getDocs(
        query(collection(db, 'events'), where('organizerEmail', '==', userEmail))
      );

      const loaded: Event[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          date: data.date,
          createdAt: data.createdAt?.toDate?.() ?? new Date(),
          isActive: data.isActive !== false,
          organizerEmail: data.organizerEmail || '',
          planType: data.planType || 'free',
          photoLimit: data.photoLimit ?? -1,
          photoCount: data.photoCount || 0,
          paymentId: data.paymentId,
          customBranding: data.customBranding,
        };
      });

      loaded.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setEvents(loaded);
    } catch (err: any) {
      // The most likely cause is the event being stored with different casing
      // from the signed-in address, which the rules compare exactly.
      console.error('Failed to load events:', err);
      setError(
        'Could not load your events. If you created them with a different email address, sign in with that one instead.'
      );
    } finally {
      setLoadingEvents(false);
    }
  }, [userEmail]);

  useEffect(() => {
    if (phase === 'signed-in') loadEvents();
  }, [phase, loadEvents]);

  const copyLink = async (eventId: string) => {
    const url = `${window.location.origin}/event/${eventId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(eventId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard is blocked outside a secure context or without permission.
      window.prompt('Copy this link:', url);
    }
  };

  // -------------------------------------------------------------- render

  if (phase === 'checking' || (busy && phase !== 'signed-out')) {
    return (
      <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
          Signing you in…
        </Typography>
      </Container>
    );
  }

  if (phase === 'link-sent') {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Paper elevation={2} sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
          <Email sx={{ fontSize: 52, color: 'primary.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Check your inbox
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            We sent a sign-in link to <strong>{email}</strong>. Open it on any device — no
            password needed.
          </Typography>
          <Button onClick={() => setPhase('signed-out')} size="small">
            Use a different email
          </Button>
        </Paper>
      </Container>
    );
  }

  if (phase === 'needs-email' || phase === 'signed-out') {
    const completing = phase === 'needs-email';

    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Paper elevation={2} sx={{ p: 4, borderRadius: 3 }}>
          <Box textAlign="center" mb={3}>
            <Typography variant="h4" gutterBottom color="primary">
              Your events
            </Typography>
            <Typography color="text.secondary">
              {completing
                ? 'Confirm the email address this link was sent to.'
                : 'Sign in with the email you used to create your events.'}
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={completing ? handleCompleteWithEmail : handleSendLink}>
            <TextField
              fullWidth
              type="email"
              label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              sx={{ mb: 2 }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={busy}
              startIcon={busy ? <CircularProgress size={18} /> : <Email />}
              sx={{ py: 1.4 }}
            >
              {completing ? 'Continue' : 'Email me a sign-in link'}
            </Button>
          </Box>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        mb={4}
      >
        <Box>
          <Typography variant="h4" color="primary">
            Your events
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {userEmail}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={loadEvents} disabled={loadingEvents}>
              <Refresh />
            </IconButton>
          </Tooltip>
          <Button startIcon={<Logout />} onClick={() => signOut()} size="small">
            Sign out
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loadingEvents && (
        <Box textAlign="center" py={6}>
          <CircularProgress />
        </Box>
      )}

      {!loadingEvents && events.length === 0 && (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}>
          <PhotoLibrary sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            No events yet
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Events you create with this email address will appear here.
          </Typography>
          <Button variant="contained" href="/">
            Create an event
          </Button>
        </Paper>
      )}

      <Stack spacing={2}>
        {events.map((event) => {
          const state = getUploadState(event);
          const remaining = describeTimeRemaining(state.closesAt);
          const organizerNote = explainUploadState(state, 'organizer');

          return (
            <Card key={event.id} variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-start"
                  spacing={2}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap>
                      {event.title}
                    </Typography>
                    <Stack direction="row" spacing={2} sx={{ mt: 0.5 }} flexWrap="wrap">
                      <Typography variant="body2" color="text.secondary">
                        <CalendarMonth sx={{ fontSize: 14, verticalAlign: -2, mr: 0.5 }} />
                        {new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <PhotoLibrary sx={{ fontSize: 14, verticalAlign: -2, mr: 0.5 }} />
                        {event.photoCount} {event.photoCount === 1 ? 'file' : 'files'}
                      </Typography>
                    </Stack>
                  </Box>

                  <Chip
                    size="small"
                    color={event.planType === 'premium' ? 'secondary' : 'default'}
                    label={event.planType === 'premium' ? 'Premium' : 'Free'}
                  />
                </Stack>

                <Divider sx={{ my: 2 }} />

                <Stack direction="row" spacing={1} alignItems="center">
                  {state.canUpload ? (
                    <Chip
                      size="small"
                      icon={<LockOpen />}
                      color="success"
                      variant="outlined"
                      label={remaining || 'Open for uploads'}
                    />
                  ) : (
                    <Chip size="small" icon={<Lock />} variant="outlined" label="Uploads closed" />
                  )}
                </Stack>

                {organizerNote && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                    {organizerNote}
                  </Typography>
                )}
              </CardContent>

              <CardActions sx={{ px: 2, pb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<Visibility />}
                  href={`/event/${event.id}`}
                >
                  Open gallery
                </Button>
                <Button
                  size="small"
                  startIcon={<ContentCopy />}
                  onClick={() => copyLink(event.id)}
                >
                  {copiedId === event.id ? 'Copied' : 'Copy guest link'}
                </Button>
              </CardActions>
            </Card>
          );
        })}
      </Stack>
    </Container>
  );
};

export default OrganizerDashboard;
