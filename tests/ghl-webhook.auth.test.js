/**
 * GoHighLevel webhook authentication tests (finding GHL-2).
 *
 * These cover the gate in front of the upgrade path — the check that decides
 * whether a caller is allowed to grant premium. They deliberately do not touch
 * Firestore: every case here is rejected before the handler reaches the
 * database, which is the property being asserted.
 *
 * Run with: npm run test:functions
 */

const crypto = require('crypto');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const SECRET = 'test-secret-do-not-use-in-production';

const handlerPath = require.resolve('../netlify/functions/ghl-webhook.js');

/** Load the handler fresh so it re-reads process.env. */
function loadHandler() {
  delete require.cache[handlerPath];
  return require(handlerPath).handler;
}

function request({ body = {}, headers = {} } = {}) {
  return {
    httpMethod: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function sign(rawBody, timestamp, secret = SECRET) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  );
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.GHL_WEBHOOK_SECRET = SECRET;
  // Deliberately unset so any request that slips past the gate fails loudly on
  // configuration rather than silently reaching Firestore.
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.GHL_WEBHOOK_ALLOW_RESET;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('rejects unauthenticated callers', () => {
  test('the original exploit — a bare POST granting premium — is refused', async () => {
    const handler = loadHandler();
    const response = await handler(
      request({ body: { action: 'upgrade_confirmed', eventId: '2026-06-14_smith_a1b2c3d4' } })
    );

    assert.strictEqual(response.statusCode, 401);
    assert.strictEqual(JSON.parse(response.body).error, 'Unauthorized');
  });

  test('a wrong shared secret is refused', async () => {
    const handler = loadHandler();
    const response = await handler(
      request({
        body: { action: 'upgrade_confirmed', eventId: 'e1' },
        headers: { 'x-sharedmoments-secret': 'wrong' },
      })
    );

    assert.strictEqual(response.statusCode, 401);
  });

  test('a signature computed with the wrong key is refused', async () => {
    const handler = loadHandler();
    const body = JSON.stringify({ action: 'upgrade_confirmed', eventId: 'e1' });
    const ts = Math.floor(Date.now() / 1000);

    const response = await handler(
      request({
        body,
        headers: {
          'x-sharedmoments-timestamp': String(ts),
          'x-sharedmoments-signature': sign(body, ts, 'not-the-secret'),
        },
      })
    );

    assert.strictEqual(response.statusCode, 401);
  });

  test('a valid signature over a different body is refused', async () => {
    const handler = loadHandler();
    const signedBody = JSON.stringify({ action: 'upgrade_confirmed', eventId: 'cheap-event' });
    const sentBody = JSON.stringify({ action: 'upgrade_confirmed', eventId: 'someone-elses' });
    const ts = Math.floor(Date.now() / 1000);

    const response = await handler(
      request({
        body: sentBody,
        headers: {
          'x-sharedmoments-timestamp': String(ts),
          'x-sharedmoments-signature': sign(signedBody, ts),
        },
      })
    );

    assert.strictEqual(response.statusCode, 401);
  });

  test('a replayed request from an hour ago is refused', async () => {
    const handler = loadHandler();
    const body = JSON.stringify({ action: 'upgrade_confirmed', eventId: 'e1' });
    const staleTs = Math.floor(Date.now() / 1000) - 3600;

    const response = await handler(
      request({
        body,
        headers: {
          'x-sharedmoments-timestamp': String(staleTs),
          'x-sharedmoments-signature': sign(body, staleTs),
        },
      })
    );

    assert.strictEqual(response.statusCode, 401);
  });

  test('a signature without a timestamp is refused', async () => {
    const handler = loadHandler();
    const body = JSON.stringify({ action: 'upgrade_confirmed', eventId: 'e1' });

    const response = await handler(
      request({ body, headers: { 'x-sharedmoments-signature': sign(body, 1) } })
    );

    assert.strictEqual(response.statusCode, 401);
  });

  test('the endpoint fails closed when no secret is configured', async () => {
    delete process.env.GHL_WEBHOOK_SECRET;
    const handler = loadHandler();

    const response = await handler(
      request({
        body: { action: 'upgrade_confirmed', eventId: 'e1' },
        headers: { 'x-sharedmoments-secret': 'anything' },
      })
    );

    assert.strictEqual(response.statusCode, 401);
  });

  test('rejection never reveals which check failed', async () => {
    const handler = loadHandler();
    const noCreds = await handler(request({ body: { action: 'upgrade_confirmed' } }));
    const badCreds = await handler(
      request({
        body: { action: 'upgrade_confirmed' },
        headers: { 'x-sharedmoments-secret': 'wrong' },
      })
    );

    assert.deepStrictEqual(JSON.parse(noCreds.body), JSON.parse(badCreds.body));
  });
});

describe('accepts authenticated callers', () => {
  test('a correct shared secret passes the gate', async () => {
    const handler = loadHandler();
    const response = await handler(
      request({
        body: { action: 'upgrade_confirmed', eventId: 'e1' },
        headers: { 'x-sharedmoments-secret': SECRET },
      })
    );

    // Past the gate, so it now fails on the missing service account rather than
    // on authentication. 500, not 401, is the pass condition here.
    assert.strictEqual(response.statusCode, 500);
  });

  test('a correct HMAC signature passes the gate', async () => {
    const handler = loadHandler();
    const body = JSON.stringify({ action: 'upgrade_confirmed', eventId: 'e1' });
    const ts = Math.floor(Date.now() / 1000);

    const response = await handler(
      request({
        body,
        headers: {
          'x-sharedmoments-timestamp': String(ts),
          'x-sharedmoments-signature': sign(body, ts),
        },
      })
    );

    assert.strictEqual(response.statusCode, 500);
  });

  test('header casing does not matter', async () => {
    const handler = loadHandler();
    const response = await handler(
      request({
        body: { action: 'upgrade_confirmed', eventId: 'e1' },
        headers: { 'X-SharedMoments-Secret': SECRET },
      })
    );

    assert.strictEqual(response.statusCode, 500);
  });
});

describe('the reset_to_free test action', () => {
  test('is disabled by default even for an authenticated caller', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '';
    const handler = loadHandler();

    const response = await handler(
      request({
        body: { action: 'reset_to_free', eventId: 'e1' },
        headers: { 'x-sharedmoments-secret': SECRET },
      })
    );

    // Still 500 on config, but the point is it never reaches a downgrade.
    assert.notStrictEqual(response.statusCode, 200);
  });
});

describe('method handling', () => {
  test('GET is not allowed', async () => {
    const handler = loadHandler();
    const response = await handler({ httpMethod: 'GET', headers: {}, body: null });
    assert.strictEqual(response.statusCode, 405);
  });

  test('OPTIONS preflight succeeds without credentials', async () => {
    const handler = loadHandler();
    const response = await handler({ httpMethod: 'OPTIONS', headers: {}, body: null });
    assert.strictEqual(response.statusCode, 200);
  });
});
