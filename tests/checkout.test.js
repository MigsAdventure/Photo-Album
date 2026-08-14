/**
 * Checkout: the signed reference, and the price.
 *
 * The reference is what replaced `localStorage.pendingUpgrade` as the way the
 * post-payment page works out which event was paid for. It is signed rather than
 * a bare event id because the success page uses it to read plan state, and event
 * ids are semi-guessable by construction (`YYYY-MM-DD_title-slug_8char`) — an
 * unsigned identifier would let anyone enumerate events.
 *
 * So the tests that matter here are the negative ones: a forged, tampered,
 * expired or foreign-signed ref must not resolve.
 *
 * Run with: npm run test:checkout
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const refPath = require.resolve('../netlify/functions/_lib/checkout-ref.js');
const pricingPath = require.resolve('../netlify/functions/_lib/pricing.js');

const SECRET = 'test-checkout-secret-do-not-use';

/** Reload so the module re-reads process.env. */
function loadRef() {
  delete require.cache[refPath];
  return require(refPath);
}

function loadPricing() {
  delete require.cache[pricingPath];
  return require(pricingPath);
}

const originalEnv = { ...process.env };

// ---------------------------------------------------------------- checkout-ref

describe('the checkout reference round-trips', () => {
  beforeEach(() => {
    process.env.CHECKOUT_REF_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete require.cache[refPath];
  });

  test('an event id survives the trip', () => {
    const { createRef, readRef } = loadRef();

    const ref = createRef('2026-06-14_smith_a1b2c3d4');
    const parsed = readRef(ref);

    assert.ok(parsed);
    assert.strictEqual(parsed.eventId, '2026-06-14_smith_a1b2c3d4');
  });

  test('two refs for the same event differ but both resolve', () => {
    const { createRef, readRef } = loadRef();

    const a = createRef('evt_1');
    const b = createRef('evt_1');

    assert.strictEqual(readRef(a).eventId, 'evt_1');
    assert.strictEqual(readRef(b).eventId, 'evt_1');
  });
});

describe('the checkout reference refuses anything it did not sign', () => {
  beforeEach(() => {
    process.env.CHECKOUT_REF_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete require.cache[refPath];
  });

  test('a swapped event id is rejected', () => {
    const { createRef, readRef } = loadRef();

    const ref = createRef('evt_mine');
    const [, signature] = ref.split('.');

    // Re-encode a different event id against the original signature — the shape
    // an attacker would try when reading someone else's plan state.
    const forgedPayload = Buffer.from(JSON.stringify({ e: 'evt_theirs', t: 1 }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    assert.strictEqual(readRef(`${forgedPayload}.${signature}`), null);
  });

  test('a tampered signature is rejected', () => {
    const { createRef, readRef } = loadRef();

    const ref = createRef('evt_1');
    const [payload, signature] = ref.split('.');
    const flipped = signature.slice(0, -1) + (signature.endsWith('a') ? 'b' : 'a');

    assert.strictEqual(readRef(`${payload}.${flipped}`), null);
  });

  test('a ref signed with a different secret is rejected', () => {
    const { createRef } = loadRef();
    const ref = createRef('evt_1');

    process.env.CHECKOUT_REF_SECRET = 'a-completely-different-secret';
    const { readRef } = loadRef();

    assert.strictEqual(readRef(ref), null);
  });

  test('an expired ref is rejected', () => {
    const { readRef, REF_TTL_SECONDS } = loadRef();

    // Mint one by hand with an old timestamp, signed correctly — so the only
    // thing wrong with it is its age.
    const stale = Math.floor(Date.now() / 1000) - REF_TTL_SECONDS - 60;
    const payload = Buffer.from(JSON.stringify({ e: 'evt_1', t: stale }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(payload, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    assert.strictEqual(readRef(`${payload}.${signature}`), null);
  });

  test('a future-dated ref is rejected', () => {
    const { readRef } = loadRef();

    const future = Math.floor(Date.now() / 1000) + 60 * 60;
    const payload = Buffer.from(JSON.stringify({ e: 'evt_1', t: future }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(payload, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    assert.strictEqual(readRef(`${payload}.${signature}`), null);
  });

  test('malformed input is rejected rather than throwing', () => {
    const { readRef } = loadRef();

    for (const bad of [null, undefined, '', 'no-dot', '.', 'a.', '.b', 'a.b.c', 42, {}]) {
      assert.strictEqual(readRef(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  test('a valid ref with anything appended is rejected', () => {
    const { createRef, readRef } = loadRef();
    const ref = createRef('evt_1');

    // Destructuring split('.') ignores a third part, so this verified fine and
    // the reference had no canonical form — two different strings resolving to
    // the same event.
    assert.strictEqual(readRef(`${ref}.junk`), null);
    assert.strictEqual(readRef(`${ref}.`), null);
  });
});

describe('the checkout reference fails closed when unconfigured', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    delete require.cache[refPath];
  });

  test('no secret means nothing verifies', () => {
    process.env.CHECKOUT_REF_SECRET = SECRET;
    const ref = loadRef().createRef('evt_1');

    delete process.env.CHECKOUT_REF_SECRET;
    delete process.env.INTERNAL_SERVICE_SECRET;

    // An unset secret must not mean "accept everything" — that is the shape of
    // the GHL-2 vulnerability, where a missing secret disabled the check.
    assert.strictEqual(loadRef().readRef(ref), null);
  });

  test('minting without a secret throws rather than issuing an unsigned ref', () => {
    delete process.env.CHECKOUT_REF_SECRET;
    delete process.env.INTERNAL_SERVICE_SECRET;

    assert.throws(() => loadRef().createRef('evt_1'), /not configured/i);
  });
});

// ------------------------------------------------------- the return path agrees

describe('the checkout return path matches a real route', () => {
  // checkout-start builds the URL the customer comes back to. Nothing links it to
  // the router, and the app has no catch-all route, so a mismatch drops someone
  // who has just paid onto a blank page with no way back. It was written as
  // `/payment-success` while the route is `/payment/success`.
  test('PAYMENT_RETURN_PATH is a route defined in App.tsx', () => {
    const fnSource = fs.readFileSync(
      path.join(__dirname, '..', 'netlify', 'functions', 'checkout-start.js'),
      'utf8'
    );

    const match = fnSource.match(/const PAYMENT_RETURN_PATH = '([^']+)'/);
    assert.ok(match, 'checkout-start.js should define PAYMENT_RETURN_PATH');

    const returnPath = match[1];

    const appSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'App.tsx'),
      'utf8'
    );

    const routes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

    assert.ok(
      routes.includes(returnPath),
      `checkout-start returns customers to "${returnPath}", which is not one of the ` +
        `routes in App.tsx: ${routes.join(', ')}`
    );
  });
});

// -------------------------------------------------------------------- pricing

describe('pricing is decided server-side', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    delete require.cache[pricingPath];
  });

  test('the default offer is $29', () => {
    delete process.env.UPGRADE_PRICE_CENTS;
    const { upgradeOffer } = loadPricing();

    const offer = upgradeOffer();
    assert.strictEqual(offer.priceCents, 2900);
    assert.strictEqual(offer.display, '$29');
  });

  test('the price is configurable without touching the client', () => {
    process.env.UPGRADE_PRICE_CENTS = '4900';
    const { upgradeOffer } = loadPricing();

    assert.strictEqual(upgradeOffer().display, '$49');
  });

  test('a non-whole amount keeps its cents', () => {
    const { formatPrice } = loadPricing();

    assert.strictEqual(formatPrice(2950), '$29.50');
    assert.strictEqual(formatPrice(2900), '$29');
  });

  test('a nonsense price falls back rather than charging zero', () => {
    for (const bad of ['0', '-100', 'free', '']) {
      process.env.UPGRADE_PRICE_CENTS = bad;
      const { upgradeOffer, DEFAULT_PRICE_CENTS } = loadPricing();

      assert.strictEqual(
        upgradeOffer().priceCents,
        DEFAULT_PRICE_CENTS,
        `expected the default for UPGRADE_PRICE_CENTS=${JSON.stringify(bad)}`
      );
    }
  });

  test('an unconfigured checkout URL throws instead of sending customers nowhere', () => {
    delete process.env.CHECKOUT_URL;
    const { checkoutBaseUrl } = loadPricing();

    assert.throws(() => checkoutBaseUrl(), /CHECKOUT_URL/);
  });
});
