/**
 * Has the upgrade landed yet?
 *
 * The success page polls this after the customer returns from the order form.
 *
 * Why polling, rather than trusting the redirect
 * ----------------------------------------------
 * Coming back to `/payment/success` means the customer finished the form. It
 * does not mean the money has settled or that GoHighLevel has called our
 * webhook yet — the redirect and the webhook are two independent races, and the
 * redirect usually wins. The old page assumed otherwise: it said "Payment
 * successful, your event is upgraded" the moment it rendered, so a customer
 * could read that, return to the gallery, and still find uploads closed. Then
 * they email support.
 *
 * So the page asks, repeatedly, until the plan actually flips — and says
 * something honest while it waits.
 *
 * Access is by signed `ref` only. It carries no authority to change anything;
 * it answers exactly one question about one event.
 */

const { getDb, isConfigured } = require('./_lib/firebase-admin');
const { readRef } = require('./_lib/checkout-ref');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!isConfigured()) {
    console.error('checkout-status: FIREBASE_SERVICE_ACCOUNT is not set');
    return json(503, { error: 'Unavailable right now' });
  }

  const ref = (event.queryStringParameters || {}).ref;
  const parsed = readRef(ref);

  if (!parsed) {
    // Covers malformed, forged and expired alike. The customer-facing copy must
    // not read as a failure of their payment — it is a stale link, and their
    // upgrade may well have gone through.
    return json(400, {
      error: 'This upgrade link has expired.',
      reason: 'invalid_ref',
    });
  }

  const snapshot = await getDb().collection('events').doc(parsed.eventId).get();

  if (!snapshot.exists) {
    return json(404, { error: 'That event could not be found', reason: 'no_event' });
  }

  const data = snapshot.data();

  return json(200, {
    eventId: parsed.eventId,
    eventTitle: data.title || null,
    planType: data.planType === 'premium' ? 'premium' : 'free',
    upgraded: data.planType === 'premium',
  });
};
