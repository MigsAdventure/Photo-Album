/**
 * Prove that the caller is the organizer of a given event.
 *
 * This was written for `delete-photo` in Phase 4 and lived inside it. Checkout
 * needs exactly the same check — deciding who is allowed to buy an upgrade is
 * the same question as deciding who is allowed to moderate — so it moved here
 * rather than being written a second time. Two copies of an authorisation check
 * is how one of them ends up weaker than the other.
 *
 * What makes this real authorisation, as opposed to a claim we take on trust:
 * `verifyIdToken` checks the token's signature against Google's rotating public
 * keys and its expiry. A caller cannot simply assert an email address.
 *
 * Refs: AUDIT_2026-08.md SEC-5, UX-2
 */

const { admin, getApp } = require('./firebase-admin');

/**
 * Verify a Firebase ID token and confirm the holder organizes this event.
 *
 * @returns the organizer's lowercased email when authorised, or null. Callers
 *          must treat null as "not authorised" — never as "probably fine".
 */
async function verifyOrganizer(idToken, eventId, db) {
  if (!idToken || !eventId) return null;

  try {
    const decoded = await admin.auth(getApp()).verifyIdToken(idToken);

    // An unverified email proves nothing. Email-link sign-in sets this, so a
    // legitimate organizer always has it.
    if (!decoded.email || decoded.email_verified !== true) {
      console.warn('organizer-auth: token has no verified email');
      return null;
    }

    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) return null;

    const organizerEmail = String(eventDoc.data().organizerEmail || '').toLowerCase();
    if (!organizerEmail) return null;

    return decoded.email.toLowerCase() === organizerEmail ? organizerEmail : null;
  } catch (error) {
    // Expired or forged tokens land here. Not an error worth surfacing — the
    // caller simply is not authorised.
    console.warn('organizer-auth: could not verify ID token:', error.message);
    return null;
  }
}

/** Pull a bearer token out of the Authorization header, case-insensitively. */
function bearerToken(headers) {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
  if (!key) return null;

  const value = String(headers[key] || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

module.exports = { verifyOrganizer, bearerToken };
