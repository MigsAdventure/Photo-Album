/**
 * Durable rate limiter tests (findings SEC-4, ZIP-9).
 *
 * Runs against the Firestore emulator via the Admin SDK, so it exercises the
 * real transaction behaviour rather than a mock. The whole point of this module
 * is that the counter is shared rather than process-local, and that is only
 * observable against a real datastore.
 *
 * Run with: npm run test:rules (the emulator wrapper covers both files)
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');

// A different project id from the rules suite on purpose. Both files run
// against the same emulator instance, and the rules suite calls
// clearFirestore(), which wipes everything in its own project. Sharing an id
// meant that clear could land between this suite's write and its read, failing
// tests non-deterministically depending on interleaving. The emulator keeps
// projects fully separate, so distinct ids give real isolation.
const PROJECT_ID = 'sharedmoments-ratelimit-test';

// Point the Admin SDK at the emulator and give it a credential it will not use.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: PROJECT_ID,
  private_key: 'emulator',
  client_email: 'emulator@example.com',
});

const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const { checkAndRecord, checkDownloadRequest } = require('../netlify/functions/_lib/rate-limit');

async function clearCollection() {
  const db = admin.firestore();
  const snapshot = await db.collection('downloadJobs').get();
  await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
}

beforeEach(clearCollection);

describe('sliding window', () => {
  test('allows requests up to the limit, then blocks', async () => {
    for (let i = 1; i <= 3; i++) {
      const result = await checkAndRecord('event', 'e1', 3, 60_000);
      assert.strictEqual(result.allowed, true, `attempt ${i} should be allowed`);
      assert.strictEqual(result.used, i);
    }

    const blocked = await checkAndRecord('event', 'e1', 3, 60_000);
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0, 'should say when to retry');
  });

  test('separate keys have separate budgets', async () => {
    await checkAndRecord('event', 'e1', 1, 60_000);

    const other = await checkAndRecord('event', 'e2', 1, 60_000);
    assert.strictEqual(other.allowed, true);
  });

  test('separate scopes have separate budgets', async () => {
    await checkAndRecord('event', 'shared-value', 1, 60_000);

    const byEmail = await checkAndRecord('email', 'shared-value', 1, 60_000);
    assert.strictEqual(byEmail.allowed, true);
  });

  test('attempts outside the window are forgotten', async () => {
    // A 1 ms window means the first attempt has aged out by the time the second
    // arrives, which is the sliding-window property under test.
    await checkAndRecord('event', 'e-expiry', 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterWindow = await checkAndRecord('event', 'e-expiry', 1, 1);
    assert.strictEqual(afterWindow.allowed, true);
  });

  test('a blocked attempt does not extend the caller’s own lockout', async () => {
    await checkAndRecord('event', 'e-hammer', 1, 60_000);

    const first = await checkAndRecord('event', 'e-hammer', 1, 60_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await checkAndRecord('event', 'e-hammer', 1, 60_000);

    assert.strictEqual(first.allowed, false);
    assert.strictEqual(second.allowed, false);
    // If rejected attempts were recorded, the window would keep sliding forward
    // and retryAfter would not decrease.
    assert.ok(
      second.retryAfterSeconds <= first.retryAfterSeconds,
      'retry time should count down, not reset'
    );
  });

  test('the counter survives a fresh module load (the whole point)', async () => {
    await checkAndRecord('event', 'e-persist', 2, 60_000);

    // Simulate a Netlify cold start: drop the module cache and reload.
    delete require.cache[require.resolve('../netlify/functions/_lib/rate-limit')];
    const reloaded = require('../netlify/functions/_lib/rate-limit');

    const second = await reloaded.checkAndRecord('event', 'e-persist', 2, 60_000);
    const third = await reloaded.checkAndRecord('event', 'e-persist', 2, 60_000);

    assert.strictEqual(second.allowed, true);
    assert.strictEqual(third.allowed, false, 'a cold start must not reset the counter');
  });
});

describe('download policy', () => {
  beforeEach(() => {
    process.env.DOWNLOAD_LIMIT_PER_EVENT = '2';
    process.env.DOWNLOAD_LIMIT_PER_EMAIL = '3';
    process.env.DOWNLOAD_LIMIT_WINDOW_MS = '60000';
  });

  test('a normal first request is allowed', async () => {
    const result = await checkDownloadRequest('event-a', 'guest@example.com');
    assert.strictEqual(result.allowed, true);
  });

  test('repeated requests for one event are blocked', async () => {
    await checkDownloadRequest('event-b', 'a@example.com');
    await checkDownloadRequest('event-b', 'b@example.com');

    const third = await checkDownloadRequest('event-b', 'c@example.com');
    assert.strictEqual(third.allowed, false);
    assert.match(third.reason, /event/i);
  });

  test('one address spraying across many events is blocked', async () => {
    const email = 'sprayer@example.com';
    await checkDownloadRequest('event-1', email);
    await checkDownloadRequest('event-2', email);
    await checkDownloadRequest('event-3', email);

    const fourth = await checkDownloadRequest('event-4', email);
    assert.strictEqual(fourth.allowed, false);
    assert.match(fourth.reason, /email/i);
  });

  test('email matching ignores case, so capitalisation is not a bypass', async () => {
    await checkDownloadRequest('event-x1', 'Guest@Example.com');
    await checkDownloadRequest('event-x2', 'guest@example.com');
    await checkDownloadRequest('event-x3', 'GUEST@EXAMPLE.COM');

    const fourth = await checkDownloadRequest('event-x4', 'guest@example.com');
    assert.strictEqual(fourth.allowed, false);
  });
});
