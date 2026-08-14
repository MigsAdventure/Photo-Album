// Starting and tracking an upgrade.
//
// Everything that decides money now happens on the server. This file asks for a
// checkout URL and reports what came back — it does not know the price, does not
// build the payment link, and does not tell the CRM anything.
//
// What it replaces: UpgradeModal used to read the event, write localStorage,
// POST the CRM a *completed* upgrade with a fabricated payment id, and assemble
// `https://socialboostai.com/premium-upgrade-page?...&amount=29` by hand — all
// from the browser, all before the customer had seen a payment form.
//
// Refs: AUDIT_2026-08.md GHL-2, UX-1

import { getIdToken } from './authService';

export interface UpgradeOffer {
  priceCents: number;
  currency: string;
  /** Preformatted by the server so every surface shows the same string. */
  display: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
  ref: string;
  offer: UpgradeOffer;
  eventTitle: string | null;
  uploadsClosed: boolean;
  closesAt: string | null;
}

/** Thrown when the signed-in user is not the organizer of this event. */
export class NotOrganizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotOrganizerError';
  }
}

/** Thrown when the event turned out to be premium already — a normal race. */
export class AlreadyPremiumError extends Error {
  constructor() {
    super('This event is already on the premium plan.');
    this.name = 'AlreadyPremiumError';
  }
}

/**
 * Ask the server for a checkout session.
 *
 * Requires a signed-in organizer: the ID token is verified server-side against
 * Google's signing keys, so this is a real authorisation check rather than the
 * client asserting who it is.
 */
export const startCheckout = async (eventId: string): Promise<CheckoutSession> => {
  const idToken = await getIdToken();

  if (!idToken) {
    throw new NotOrganizerError('Sign in as the event organizer to upgrade this event.');
  }

  const response = await fetch('/.netlify/functions/checkout-start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ eventId }),
  });

  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON error body */
  }

  if (response.status === 403) {
    throw new NotOrganizerError(
      payload?.error || 'Sign in as the event organizer to upgrade this event.'
    );
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Could not start the upgrade. Please try again.');
  }

  if (payload.alreadyPremium) {
    throw new AlreadyPremiumError();
  }

  return payload as CheckoutSession;
};

export interface CheckoutStatus {
  eventId: string;
  eventTitle: string | null;
  planType: 'free' | 'premium';
  upgraded: boolean;
}

/**
 * Has the upgrade landed?
 *
 * Returning from the order form means the customer finished paying; it does not
 * mean our webhook has run yet. The success page polls this until the plan
 * actually flips rather than announcing success on arrival — the old page
 * claimed the event was upgraded the moment it rendered, so a customer could
 * read that and then find uploads still closed.
 *
 * Returns null for an expired or unrecognised ref, which the caller must not
 * present as a failed payment.
 */
export const getCheckoutStatus = async (ref: string): Promise<CheckoutStatus | null> => {
  const response = await fetch(
    `/.netlify/functions/checkout-status?ref=${encodeURIComponent(ref)}`
  );

  if (!response.ok) return null;

  try {
    return (await response.json()) as CheckoutStatus;
  } catch {
    return null;
  }
};
