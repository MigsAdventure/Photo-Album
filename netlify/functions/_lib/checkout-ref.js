/**
 * A signed, self-describing reference to "this event's upgrade attempt".
 *
 * The problem it solves
 * ---------------------
 * Checkout leaves our site. The customer pays on a GoHighLevel order form and
 * comes back to a success page, and that page has to work out which event was
 * just paid for.
 *
 * It used to do that by reading `pendingUpgrade` out of localStorage, written
 * immediately before the redirect. That fails in the single most likely way for
 * this product to be used: the organizer scans the QR code on their phone, opens
 * the gallery, taps upgrade — and then pays on their laptop, or in a different
 * browser, or after the tab was closed and reopened. localStorage does not
 * travel. When it was missing, the success page showed the customer a block of
 * debug output.
 *
 * A signed reference travels in the URL instead, so the return leg carries its
 * own identity and works on any device. It is signed rather than a bare event id
 * because the success page uses it to *read plan state*, and an unsigned
 * identifier would let anyone enumerate events by guessing ids — which are
 * semi-guessable by construction (`YYYY-MM-DD_title-slug_8char`).
 *
 * What it is not
 * --------------
 * It is NOT proof of payment and carries no authority to grant anything. Only
 * `ghl-webhook` upgrades an event, and only after GoHighLevel confirms a real
 * transaction. This is an identifier, not a capability.
 */

const crypto = require('crypto');

// Long enough that a customer who pays, closes the tab, and follows the receipt
// link an hour later still lands somewhere useful. Short enough that a leaked
// URL is not a permanent read handle on the event's plan state.
const REF_TTL_SECONDS = 24 * 60 * 60;

function secret() {
  const value = process.env.CHECKOUT_REF_SECRET || process.env.INTERNAL_SERVICE_SECRET;

  if (!value) {
    throw new Error(
      'CHECKOUT_REF_SECRET (or INTERNAL_SERVICE_SECRET) is not configured; ' +
        'checkout references cannot be signed.'
    );
  }

  return value;
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payloadB64) {
  return base64url(crypto.createHmac('sha256', secret()).update(payloadB64, 'utf8').digest());
}

/** Constant-time compare so a caller cannot brute-force a signature by timing. */
function safeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Mint a reference for an event. */
function createRef(eventId) {
  const payload = { e: String(eventId), t: Math.floor(Date.now() / 1000) };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));

  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Read a reference back.
 *
 * @returns {{ eventId: string, issuedAt: number } | null} — null for anything
 *          malformed, forged, or expired. Callers must not fall back to trusting
 *          an unsigned event id when this returns null; that would reopen the
 *          enumeration hole the signature exists to close.
 */
function readRef(ref) {
  if (typeof ref !== 'string' || !ref.includes('.')) return null;

  const [payloadB64, signature] = ref.split('.');
  if (!payloadB64 || !signature) return null;

  let expected;
  try {
    expected = sign(payloadB64);
  } catch {
    // Unconfigured secret. Fail closed rather than accepting everything.
    return null;
  }

  if (!safeEquals(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.e !== 'string' || typeof payload.t !== 'number') return null;

  const age = Math.floor(Date.now() / 1000) - payload.t;
  if (age < 0 || age > REF_TTL_SECONDS) return null;

  return { eventId: payload.e, issuedAt: payload.t };
}

module.exports = { createRef, readRef, REF_TTL_SECONDS };
