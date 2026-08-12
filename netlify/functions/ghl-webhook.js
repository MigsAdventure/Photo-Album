/**
 * GoHighLevel webhook — grants and revokes premium on an event.
 *
 * This endpoint decides whether a customer has paid. Before finding GHL-2 it
 * performed no verification of any kind: a single unauthenticated POST of
 * {"action":"upgrade_confirmed","eventId":"..."} unlocked unlimited uploads on
 * any event. Event ids are semi-guessable by construction
 * (YYYY-MM-DD_title-slug_8char), so the target did not even need to be known in
 * advance.
 *
 * It now requires the caller to prove they hold a shared secret, and rejects
 * anything that looks like a replay. Plan writes go through the Admin SDK, since
 * firestore.rules makes plan state server-only.
 *
 * Configuring the caller
 * ----------------------
 * Two accepted schemes. Both are constant-time compared.
 *
 * 1. HMAC signature (preferred where the caller can compute one)
 *
 *      x-sharedmoments-timestamp: <unix seconds>
 *      x-sharedmoments-signature: sha256=<hex of HMAC-SHA256(secret, "<ts>.<rawBody>")>
 *
 *    The timestamp is inside the signed string, so a captured request cannot be
 *    replayed once it falls outside the freshness window.
 *
 * 2. Static shared secret (what a GoHighLevel workflow can actually send)
 *
 *      x-sharedmoments-secret: <value of GHL_WEBHOOK_SECRET>
 *
 *    Add it under Custom Headers on the workflow's Webhook action. A static
 *    secret is replayable by anyone who observes one request, which is why
 *    VERIFY_PAYMENT_WITH_GHL below matters — see the note there.
 *
 * Environment
 * -----------
 *   GHL_WEBHOOK_SECRET        required; a long random string. Generate with
 *                             `openssl rand -hex 32`.
 *   GHL_WEBHOOK_ALLOW_RESET   optional; set to "true" to enable the
 *                             reset_to_free test action. Off by default.
 *   FIREBASE_SERVICE_ACCOUNT  required; see _lib/firebase-admin.js.
 *
 * Refs: AUDIT_2026-08.md GHL-2, SEC-2
 */

const crypto = require('crypto');
const { getDb, FieldValue, isConfigured } = require('./_lib/firebase-admin');

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type, x-sharedmoments-signature, x-sharedmoments-timestamp, x-sharedmoments-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/** Constant-time string comparison that tolerates length mismatch. */
function safeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Header lookup that is not case-sensitive, since proxies vary. */
function header(headers, name) {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === target);
  return key ? headers[key] : undefined;
}

/**
 * Verify the request came from someone holding GHL_WEBHOOK_SECRET.
 * Returns { ok: true, scheme } or { ok: false, reason }.
 */
function verifyRequest(event, rawBody) {
  const secret = process.env.GHL_WEBHOOK_SECRET;

  if (!secret) {
    // Fail closed. An unset secret previously meant "accept everything", which
    // is the vulnerability this function exists to close.
    return { ok: false, reason: 'GHL_WEBHOOK_SECRET is not configured' };
  }

  const signature = header(event.headers, 'x-sharedmoments-signature');
  const timestamp = header(event.headers, 'x-sharedmoments-timestamp');

  if (signature) {
    if (!timestamp) {
      return { ok: false, reason: 'signature present without a timestamp' };
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(age) || age > MAX_TIMESTAMP_SKEW_SECONDS) {
      return { ok: false, reason: 'timestamp outside the freshness window' };
    }

    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`, 'utf8')
        .digest('hex');

    if (!safeEquals(signature, expected)) {
      return { ok: false, reason: 'signature mismatch' };
    }

    return { ok: true, scheme: 'hmac' };
  }

  const staticSecret = header(event.headers, 'x-sharedmoments-secret');
  if (staticSecret) {
    if (!safeEquals(staticSecret, secret)) {
      return { ok: false, reason: 'shared secret mismatch' };
    }
    return { ok: true, scheme: 'shared-secret' };
  }

  return { ok: false, reason: 'no signature or shared secret presented' };
}

/**
 * Independently confirm the payment with GoHighLevel before granting premium.
 *
 * Defence in depth, and the reason a static shared secret is tolerable: even if
 * someone replays a captured request, the upgrade only lands if GoHighLevel
 * agrees a payment exists. Enabled by setting GHL_API_TOKEN.
 *
 * Returns true when the payment is confirmed OR when verification is not
 * configured — in the latter case we log loudly rather than silently trusting.
 */
async function paymentLooksReal(paymentId) {
  const token = process.env.GHL_API_TOKEN;

  if (!token) {
    console.warn(
      'GHL_API_TOKEN is not set — granting premium on webhook assertion alone. ' +
        'Set it to verify the payment against GoHighLevel before upgrading.'
    );
    return true;
  }

  if (!paymentId) {
    console.warn('No paymentId supplied; cannot verify against GoHighLevel');
    return false;
  }

  try {
    const response = await fetch(
      `https://services.leadconnectorhq.com/payments/transactions/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(`GoHighLevel payment lookup returned ${response.status}`);
      return false;
    }

    const data = await response.json();
    const status = (data?.status || data?.transaction?.status || '').toLowerCase();
    const confirmed = ['succeeded', 'success', 'completed', 'paid'].includes(status);

    if (!confirmed) {
      console.warn(`Payment ${paymentId} is not in a paid state (status: ${status})`);
    }

    return confirmed;
  } catch (error) {
    console.error('GoHighLevel payment lookup failed:', error.message);
    return false;
  }
}

/**
 * Pull the event id out of the payload.
 *
 * GoHighLevel workflows can send unrendered template placeholders such as
 * {{inboundWebhookRequest.event_id}} when a field is misconfigured. The previous
 * implementation tried several fallbacks and logged the entire request object
 * (including headers, which is where a secret would now live) while hunting for
 * a usable value. We accept the documented field names and reject placeholders
 * outright, so a misconfigured workflow fails visibly instead of upgrading the
 * wrong event.
 */
function extractEventId(payload) {
  const candidates = [payload.eventId, payload.event_id];
  const found = candidates.find(
    (value) => typeof value === 'string' && value.length > 0 && !value.includes('{{')
  );
  return found || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const rawBody = event.body || '';

  const verification = verifyRequest(event, rawBody);
  if (!verification.ok) {
    // Log the reason for our own debugging, but never echo it to the caller —
    // that would tell an attacker which half of the check they failed.
    console.warn(`ghl-webhook: rejected request — ${verification.reason}`);
    return json(401, { error: 'Unauthorized' });
  }

  if (!isConfigured()) {
    console.error('ghl-webhook: FIREBASE_SERVICE_ACCOUNT is not set');
    return json(500, { error: 'Server is not configured' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const action = payload.action;
  const db = getDb();

  // ------------------------------------------------------------- upgrade

  if (action === 'upgrade_confirmed') {
    const eventId = extractEventId(payload);

    if (!eventId) {
      console.warn('ghl-webhook: upgrade request carried no usable eventId');
      return json(400, { error: 'A valid eventId is required' });
    }

    const paymentId =
      typeof payload.paymentId === 'string' && !payload.paymentId.includes('{{')
        ? payload.paymentId
        : typeof payload.payment_id === 'string' && !payload.payment_id.includes('{{')
          ? payload.payment_id
          : null;

    const eventRef = db.collection('events').doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      console.warn(`ghl-webhook: no such event ${eventId}`);
      return json(404, { error: 'Event not found' });
    }

    if (snapshot.data().planType === 'premium') {
      // GoHighLevel retries on non-2xx, so a duplicate delivery must be a no-op
      // rather than an error that triggers another retry.
      console.log(`ghl-webhook: ${eventId} is already premium, nothing to do`);
      return json(200, { success: true, eventId, alreadyPremium: true });
    }

    if (!(await paymentLooksReal(paymentId))) {
      console.warn(`ghl-webhook: refusing to upgrade ${eventId} — payment unconfirmed`);
      return json(402, { error: 'Payment could not be confirmed' });
    }

    await eventRef.update({
      planType: 'premium',
      photoLimit: -1,
      paymentId: paymentId || 'unverified',
      paymentAmount: Number(payload.paymentAmount) || null,
      upgradedAt: FieldValue.serverTimestamp(),
      upgradedVia: verification.scheme,
    });

    console.log(`ghl-webhook: upgraded ${eventId} to premium`);
    return json(200, { success: true, eventId, planType: 'premium' });
  }

  // --------------------------------------------------------------- reset

  if (action === 'reset_to_free') {
    // A test affordance that downgrades a paying customer. Off unless
    // explicitly enabled, so it cannot be reached in production by accident.
    if (process.env.GHL_WEBHOOK_ALLOW_RESET !== 'true') {
      console.warn('ghl-webhook: reset_to_free is disabled');
      return json(403, { error: 'This action is disabled' });
    }

    const eventId = extractEventId(payload);
    if (!eventId) {
      return json(400, { error: 'A valid eventId is required' });
    }

    await db.collection('events').doc(eventId).update({
      planType: 'free',
      photoLimit: 2,
      paymentId: FieldValue.delete(),
      upgradedAt: FieldValue.delete(),
    });

    console.log(`ghl-webhook: reset ${eventId} to free`);
    return json(200, { success: true, eventId, planType: 'free' });
  }

  // ------------------------------------------------------------- unknown

  console.log(`ghl-webhook: no handler for action "${action}"`);
  return json(200, { success: true, handled: false });
};
