/**
 * Begin an upgrade. Returns the checkout URL the organizer should be sent to.
 *
 * What this replaces
 * ------------------
 * The browser used to do all of this itself, in `UpgradeModal.handleUpgrade`:
 *
 *   1. read the event
 *   2. write `pendingUpgrade` to localStorage
 *   3. POST the CRM a completed-upgrade notification — `planType: 'premium'`,
 *      `paymentAmount: 29`, `paymentId: <eventId>_<Date.now()>` — *before* the
 *      customer had seen a payment form, let alone paid
 *   4. build `https://socialboostai.com/premium-upgrade-page?...&amount=29`
 *      from a hardcoded string, and redirect
 *
 * Step 3 is the one that mattered. Every organizer who clicked "Upgrade" and
 * then changed their mind was recorded in the CRM as having upgraded, with a
 * fabricated payment id and an amount nobody had charged. The system of record
 * for who has paid was being written by a button click. Any workflow keyed on
 * that event fired for people who never paid.
 *
 * Now the CRM is notified from `ghl-webhook` when GoHighLevel confirms a real
 * transaction, and this endpoint only does what its name says.
 *
 * Authorisation
 * -------------
 * Requires a signed-in organizer. This is not about protecting a URL — the
 * checkout page is public and anyone can open it — it is about the app never
 * again presenting a payment prompt to someone who cannot act on it. Finding
 * UX-1 was a guest being shown an upgrade modal for an event they neither owned
 * nor could pay for; the same mistake in a different component.
 *
 * Environment
 * -----------
 *   CHECKOUT_URL            required; the GoHighLevel order form URL
 *   UPGRADE_PRICE_CENTS     optional; defaults to 2900
 *   CHECKOUT_REF_SECRET     required (falls back to INTERNAL_SERVICE_SECRET)
 *   PUBLIC_SITE_URL         optional; used to build the return URL
 *
 * Refs: AUDIT_2026-08.md GHL-2, UX-1, UX-2
 */

const { getDb, isConfigured } = require('./_lib/firebase-admin');
const { verifyOrganizer, bearerToken } = require('./_lib/organizer-auth');
const { checkoutBaseUrl, upgradeOffer } = require('./_lib/pricing');
const { createRef } = require('./_lib/checkout-ref');
const { getUploadState } = require('./_lib/plan');

// Must match the route in src/App.tsx. Nothing checks these agree, and the app
// has no catch-all route, so a mismatch drops a customer who has just paid onto a
// blank page.
const PAYMENT_RETURN_PATH = '/payment/success';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/**
 * Tell the CRM an upgrade was *started*.
 *
 * This replaces the browser's pre-payment call, and the distinction is the whole
 * point: the old payload said `planType: 'premium'` with a fabricated payment id,
 * so an abandoned checkout was indistinguishable from a completed one. This says
 * what actually happened — someone opened a checkout — which is genuinely useful
 * (an abandoned-cart follow-up is exactly the kind of thing GoHighLevel is good
 * at) and is not a claim about money.
 *
 * It also primes the workflow with the event data, which is why the browser call
 * existed at all: the order form needs the event id to send back to `ghl-webhook`
 * when payment completes.
 *
 * Best-effort, but still awaited. Fire-and-forget is not an option on Netlify:
 * the container is frozen the moment a response is returned, so an un-awaited
 * request is simply cancelled — the same mistake that made `email-download`'s old
 * background path silently do nothing. The timeout is therefore kept short,
 * because it lands directly in the customer's wait before the redirect.
 */
async function notifyCheckoutStarted({ eventId, eventTitle, organizerEmail, ref, offer }) {
  const url = process.env.GHL_CHECKOUT_WEBHOOK_URL;
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'checkout_started',
        event_id: eventId,
        event_title: eventTitle,
        organizer_email: organizerEmail,
        checkout_ref: ref,
        quoted_amount: offer.priceCents / 100,
        currency: offer.currency,
        started_at: new Date().toISOString(),
        source: 'sharedmoments',
      }),
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      console.warn(`checkout-start: CRM notification returned ${response.status}`);
    }
  } catch (error) {
    console.warn('checkout-start: CRM notification failed —', error.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!isConfigured()) {
    console.error('checkout-start: FIREBASE_SERVICE_ACCOUNT is not set');
    return json(503, { error: 'Upgrades are unavailable right now. Please try again shortly.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const { eventId } = body;
  if (!eventId || typeof eventId !== 'string') {
    return json(400, { error: 'eventId is required' });
  }

  try {
    return await issueCheckout(event, eventId);
  } catch (error) {
    // Firestore and the CRM are both reachable from here. An unhandled throw
    // would surface as a bare 500 to someone trying to give us money.
    console.error('checkout-start failed:', error);
    return json(500, { error: 'Could not start the upgrade. Please try again.' });
  }
};

async function issueCheckout(event, eventId) {
  const db = getDb();
  const idToken = bearerToken(event.headers);

  const organizerEmail = await verifyOrganizer(idToken, eventId, db);
  if (!organizerEmail) {
    // Deliberately the same response whether the token was absent, expired, or
    // belonged to someone else: distinguishing them tells a caller which events
    // exist and who organizes them.
    return json(403, {
      error: 'Sign in as the event organizer to upgrade this event.',
      reason: 'not_organizer',
    });
  }

  const snapshot = await db.collection('events').doc(eventId).get();
  if (!snapshot.exists) {
    return json(404, { error: 'That event could not be found' });
  }

  const eventData = snapshot.data();

  // Nothing to sell. Returning 200 with alreadyPremium rather than an error
  // because this is a normal race: two tabs open, or a webhook that landed while
  // the modal was on screen.
  if (eventData.planType === 'premium') {
    return json(200, { alreadyPremium: true, eventId });
  }

  // createRef belongs in here with the pricing lookup: it throws when neither
  // CHECKOUT_REF_SECRET nor INTERNAL_SERVICE_SECRET is set, and that is precisely
  // the state a freshly deployed site is in. Outside the catch it produced an
  // unhandled rejection and a bare 500, so the one misconfiguration most likely
  // to happen was the one that reported itself worst.
  let offer;
  let baseUrl;
  let ref;
  try {
    offer = upgradeOffer();
    baseUrl = checkoutBaseUrl();
    ref = createRef(eventId);
  } catch (error) {
    console.error('checkout-start: checkout is not configured —', error.message);
    return json(503, { error: 'Upgrades are unavailable right now. Please try again shortly.' });
  }

  // The order form gets what it needs to identify and describe the purchase.
  // Note what is absent: no amount. The order form owns the price; sending our
  // own would let a modified client propose one.
  const params = new URLSearchParams({
    ref,
    event_id: eventId,
    event_title: eventData.title || 'Event',
    organizer_email: organizerEmail,
  });

  const siteUrl = process.env.PUBLIC_SITE_URL || process.env.URL;
  if (siteUrl) {
    // Carry the ref home so the success page can identify the event without
    // depending on storage that may not exist on the device that paid.
    //
    // The path must match src/App.tsx exactly. It is `/payment/success`, not
    // `/payment-success` — there is no catch-all route, so a wrong path lands a
    // paying customer on a blank page with no way back.
    params.set('return_url', `${siteUrl.replace(/\/$/, '')}${PAYMENT_RETURN_PATH}?ref=${ref}`);
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  const checkoutUrl = `${baseUrl}${separator}${params.toString()}`;

  const uploadState = getUploadState(eventData);

  await notifyCheckoutStarted({
    eventId,
    eventTitle: eventData.title || null,
    organizerEmail,
    ref,
    offer,
  });

  console.log(`checkout-start: issued checkout for ${eventId} to ${organizerEmail}`);

  return json(200, {
    checkoutUrl,
    ref,
    offer,
    eventTitle: eventData.title || null,
    uploadsClosed: !uploadState.canUpload,
    closesAt: uploadState.closesAt ? uploadState.closesAt.toISOString() : null,
  });
}
