// Organizer sign-in via emailed magic link (finding UX-2).
//
// Until now the application had no authentication at all. Organizers were
// identified only by an email string on the event document, which meant:
//
//   - security rules could not establish identity, so ownership was advisory
//     and every destructive path had to be routed through a server function
//     holding a secret (see docs/decisions/0001)
//   - creating an event returned a QR code and an email, and that was the end
//     of it. Lose the email and the event was gone — nothing listed your events
//     because nothing knew they were yours
//
// Firebase Auth's email-link sign-in fits this product better than a password.
// There is no account to create, no password to forget, and the organizer's
// email is already the thing we identify them by. Signing in proves control of
// that mailbox, which is exactly the claim we need.
//
// Once signed in, `request.auth.token.email` is available in firestore.rules,
// so an organizer can be granted access to their own events directly rather
// than through a server proxy.
//
// Setup required in the Firebase console: Authentication → Sign-in method →
// enable "Email/Password" and, under it, "Email link (passwordless sign-in)".
// Add the deployed domain under Authentication → Settings → Authorized domains.

import {
  getAuth,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import app from '../firebase';

export const auth = getAuth(app);

// Firebase requires the email again when completing sign-in, to stop a leaked
// link being usable on a different device. We keep it here so the common case
// (same browser) needs no retyping; if it is missing we ask.
const PENDING_EMAIL_KEY = 'sharedmoments-signin-email';

export interface SignInResult {
  user: User;
  email: string;
}

/**
 * Email a sign-in link.
 *
 * The link returns to /dashboard, which completes the sign-in. Firebase requires
 * the continue URL's domain to be on the authorized list, so a new deployment
 * domain needs adding in the console before this works there.
 */
export const sendMagicLink = async (email: string): Promise<void> => {
  const trimmed = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('That email address does not look right');
  }

  await sendSignInLinkToEmail(auth, trimmed, {
    url: `${window.location.origin}/dashboard`,
    handleCodeInApp: true,
  });

  try {
    window.localStorage.setItem(PENDING_EMAIL_KEY, trimmed);
  } catch {
    // Private browsing can refuse localStorage. Sign-in still works — the user
    // is asked to retype their address when they land.
  }
};

/** Is the current URL a sign-in link we should complete? */
export const isMagicLink = (url: string = window.location.href): boolean =>
  isSignInWithEmailLink(auth, url);

/**
 * Complete sign-in from the emailed link.
 *
 * @param providedEmail supply when the address is not in localStorage — for
 *        example when the link is opened on a different device from the one
 *        that requested it.
 */
export const completeMagicLinkSignIn = async (
  providedEmail?: string
): Promise<SignInResult> => {
  const stored = (() => {
    try {
      return window.localStorage.getItem(PENDING_EMAIL_KEY);
    } catch {
      return null;
    }
  })();

  const email = (providedEmail || stored || '').trim().toLowerCase();

  if (!email) {
    // Not an error state — the caller should prompt. Distinguished by name so
    // the UI can tell "ask for the address" apart from "the link is bad".
    const error = new Error('Please confirm the email address this link was sent to');
    error.name = 'EmailRequiredError';
    throw error;
  }

  try {
    const credential = await signInWithEmailLink(auth, email, window.location.href);

    try {
      window.localStorage.removeItem(PENDING_EMAIL_KEY);
    } catch {
      /* ignore */
    }

    return { user: credential.user, email };
  } catch (error: any) {
    // Firebase's messages here are developer-facing ("auth/invalid-action-code").
    // Translate the ones an organizer can actually hit.
    if (error?.code === 'auth/invalid-action-code') {
      throw new Error(
        'That sign-in link has expired or was already used. Request a new one.'
      );
    }
    if (error?.code === 'auth/invalid-email') {
      throw new Error('That email does not match the address the link was sent to.');
    }
    throw error;
  }
};

/** Subscribe to sign-in state. Returns the unsubscribe function. */
export const onAuthChange = (callback: (user: User | null) => void): (() => void) =>
  onAuthStateChanged(auth, callback);

export const getCurrentUser = (): User | null => auth.currentUser;

export const getCurrentUserEmail = (): string | null =>
  auth.currentUser?.email?.toLowerCase() ?? null;

export const signOut = async (): Promise<void> => {
  await firebaseSignOut(auth);
};

/**
 * A fresh ID token for authenticating calls to our own functions.
 *
 * Server-side these are verified with admin.auth().verifyIdToken(), which checks
 * the signature and expiry — so a caller cannot simply assert an email address.
 */
export const getIdToken = async (): Promise<string | null> => {
  const user = auth.currentUser;
  return user ? user.getIdToken() : null;
};
