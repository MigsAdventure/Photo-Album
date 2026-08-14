/**
 * Durable rate limiting backed by Firestore.
 *
 * Replaces the in-memory Maps in email-download.js and the Cloudflare Worker
 * (finding ZIP-9). Those could not work: Netlify starts a fresh container per
 * cold start and Cloudflare runs a separate isolate in every edge location, so
 * each copy saw a fraction of traffic and forgot everything between
 * invocations. Roughly 250 lines of code that limited nothing.
 *
 * The companion "circuit breaker" was worse — it keyed on a requestId generated
 * inside the same handler, so `attempts` was always zero and the breaker could
 * never open.
 *
 * Firestore transactions give a single shared counter across every region and
 * every cold start. The `downloadJobs` collection is denied to clients in
 * firestore.rules, so a caller can neither read the counter they are subject to
 * nor clear it.
 *
 * Refs: AUDIT_2026-08.md SEC-4, ZIP-9
 */

const crypto = require('crypto');
const { getDb } = require('./firebase-admin');

const COLLECTION = 'downloadJobs';

/** Firestore document ids cannot contain '/', and emails are user input. */
function keyFor(scope, value) {
  return `${scope}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;
}

/**
 * Record an attempt against a sliding window and report whether it is allowed.
 *
 * Runs in a transaction so two simultaneous requests cannot both read "2 of 3
 * used" and both proceed.
 *
 * @param {string} scope       e.g. 'event' or 'email'
 * @param {string} value       the thing being limited
 * @param {number} limit       max attempts within the window
 * @param {number} windowMs    window length in milliseconds
 * @returns {Promise<{allowed: boolean, used: number, limit: number, retryAfterSeconds: number}>}
 */
async function checkAndRecord(scope, value, limit, windowMs) {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(keyFor(scope, value));
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);

    const previous = snapshot.exists ? snapshot.data().attempts || [] : [];
    const recent = previous.filter((ts) => now - ts < windowMs);

    if (recent.length >= limit) {
      const oldest = Math.min(...recent);
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));

      // Deliberately not recording this attempt. Otherwise a client hammering
      // the endpoint keeps pushing its own window forward and locks itself out
      // for far longer than the policy says.
      return { allowed: false, used: recent.length, limit, retryAfterSeconds };
    }

    recent.push(now);

    tx.set(
      ref,
      {
        scope,
        attempts: recent,
        updatedAt: new Date(now),
        // Lets a scheduled cleanup drop stale documents; without it this
        // collection grows forever.
        expiresAt: new Date(now + windowMs * 2),
      },
      { merge: true }
    );

    return { allowed: true, used: recent.length, limit, retryAfterSeconds: 0 };
  });
}

/**
 * Apply the download policy: a per-event ceiling and a per-email ceiling.
 *
 * Both matter. Per-event stops one gallery being archived repeatedly to burn
 * processing cost; per-email stops one address being used to spray requests
 * across many events.
 *
 * Fails OPEN on an infrastructure error. A Firestore outage should not stop
 * customers getting their photos — this is abuse control, not an authorisation
 * boundary. Authorisation lives in the shared-secret checks.
 */
async function checkDownloadRequest(eventId, email) {
  const perEventLimit = Number(process.env.DOWNLOAD_LIMIT_PER_EVENT || 5);
  const perEmailLimit = Number(process.env.DOWNLOAD_LIMIT_PER_EMAIL || 10);
  const windowMs = Number(process.env.DOWNLOAD_LIMIT_WINDOW_MS || 60 * 60 * 1000);

  try {
    const byEvent = await checkAndRecord('event', eventId, perEventLimit, windowMs);
    if (!byEvent.allowed) {
      return {
        allowed: false,
        reason: 'This event has had several download requests recently.',
        retryAfterSeconds: byEvent.retryAfterSeconds,
      };
    }

    const byEmail = await checkAndRecord('email', email.toLowerCase(), perEmailLimit, windowMs);
    if (!byEmail.allowed) {
      return {
        allowed: false,
        reason: 'Too many download requests from this email address.',
        retryAfterSeconds: byEmail.retryAfterSeconds,
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Rate limit check failed, allowing the request:', error.message);
    return { allowed: true, degraded: true };
  }
}

module.exports = { checkAndRecord, checkDownloadRequest };
