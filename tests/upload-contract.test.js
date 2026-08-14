/**
 * The two seams between components that the phase 1-4 review found broken.
 *
 * Both are the same class of defect: one side of a boundary speaks a contract
 * the other side does not honour, and nothing fails loudly when they disagree.
 * Neither showed up in the existing suites because both components are correct
 * in isolation — it is only the join that is wrong.
 *
 *   1. The processor counts files it could not fetch and reports the number.
 *      email-download accepted the callback and dropped the field, so the
 *      "some files are missing" notice built for ZIP-7 could never render.
 *
 *   2. The client validates media by extension when the browser gives it no
 *      MIME type (.HEIC, some Android pickers). upload-init judged by MIME type
 *      alone, so those files passed client validation and came back 400.
 *
 * Run with: npm run test:upload
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// --------------------------------------------------------------------------
// 1. failedCount survives the callback
// --------------------------------------------------------------------------

const emailsPath = require.resolve('../netlify/functions/_lib/emails.js');
const downloadPath = require.resolve('../netlify/functions/email-download.js');

const INTERNAL_SECRET = 'test-internal-secret';

/**
 * Load email-download with the email module stubbed, capturing what the handler
 * actually passes to sendArchiveReadyEmail. Stubbing at require.cache rather
 * than asserting on rendered HTML keeps the test on the boundary that broke.
 */
function loadHandlerCapturingEmails() {
  const sent = [];

  delete require.cache[emailsPath];
  require(emailsPath);
  require.cache[emailsPath].exports = {
    ...require.cache[emailsPath].exports,
    sendArchiveReadyEmail: async (args) => {
      sent.push(args);
      return { ok: true };
    },
  };

  delete require.cache[downloadPath];
  const { handler } = require(downloadPath);

  return { handler, sent };
}

function processorCallback(body) {
  return {
    httpMethod: 'POST',
    headers: { 'x-sharedmoments-internal': INTERNAL_SECRET },
    body: JSON.stringify(body),
  };
}

const originalEnv = { ...process.env };

describe('the processor callback carries failedCount all the way to the email', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = INTERNAL_SECRET;
    process.env.R2_PUBLIC_URL = 'https://photos.example.com';
    // Unset so the Firestore write is skipped — this test is about the email
    // arguments, and isConfigured() gates the persistence branch.
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete require.cache[emailsPath];
    delete require.cache[downloadPath];
  });

  test('a short archive reports how many files are missing', async () => {
    const { handler, sent } = loadHandlerCapturingEmails();

    const response = await handler(
      processorCallback({
        source: 'processor',
        email: 'guest@example.com',
        eventId: '2026-06-14_smith_a1b2c3d4',
        downloadUrl: 'https://photos.example.com/archives/smith.zip',
        fileCount: 47,
        finalSizeMB: 812.5,
        failedCount: 3,
      })
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(sent.length, 1);

    // The assertion that fails against the old handler: it destructured the body
    // without failedCount, so this arrived undefined and the template defaulted
    // it to 0.
    assert.strictEqual(sent[0].failedCount, 3);
  });

  test('a complete archive reports zero, not undefined', async () => {
    const { handler, sent } = loadHandlerCapturingEmails();

    await handler(
      processorCallback({
        source: 'processor',
        email: 'guest@example.com',
        eventId: '2026-06-14_smith_a1b2c3d4',
        downloadUrl: 'https://photos.example.com/archives/smith.zip',
        fileCount: 50,
        finalSizeMB: 900,
      })
    );

    assert.strictEqual(sent[0].failedCount, 0);
  });

  test('a non-numeric failedCount degrades to zero rather than rendering garbage', async () => {
    const { handler, sent } = loadHandlerCapturingEmails();

    await handler(
      processorCallback({
        source: 'processor',
        email: 'guest@example.com',
        eventId: '2026-06-14_smith_a1b2c3d4',
        downloadUrl: 'https://photos.example.com/archives/smith.zip',
        failedCount: 'three',
      })
    );

    assert.strictEqual(sent[0].failedCount, 0);
  });
});

describe('the missing-files notice actually renders', () => {
  // Guards the other half: the handler can forward the count correctly and the
  // template can still ignore it.
  test('the count reaches the rendered email', async () => {
    delete require.cache[emailsPath];
    const emails = require(emailsPath);

    const html = emails.renderArchiveReadyEmail
      ? emails.renderArchiveReadyEmail({
          downloadUrl: 'https://photos.example.com/a.zip',
          fileCount: 47,
          finalSizeMB: 812.5,
          failedCount: 3,
        })
      : null;

    if (html === null) {
      // No separate render export — assert on the source instead, so this test
      // still fails if the notice is deleted from the template.
      const source = fs.readFileSync(emailsPath, 'utf8');
      assert.match(source, /failedCount > 0/);
      assert.match(source, /could not be included/);
      return;
    }

    assert.match(html, /3 files could not be included/);
  });
});

// --------------------------------------------------------------------------
// 2. Client and server agree on what counts as media
// --------------------------------------------------------------------------

const { resolveContentType } = require('../netlify/functions/upload-init.js');

describe('upload-init resolves the content type the browser failed to supply', () => {
  test('a declared media type is honoured unchanged', () => {
    assert.strictEqual(resolveContentType('image/jpeg', 'a.jpg'), 'image/jpeg');
    assert.strictEqual(resolveContentType('video/mp4', 'a.mp4'), 'video/mp4');
  });

  test('the HEIC case — the exact upload that used to 400', () => {
    // Safari hands the picker a .HEIC with an empty file.type; the client sends
    // 'application/octet-stream' and the old server rejected it outright.
    assert.strictEqual(
      resolveContentType('application/octet-stream', 'IMG_4821.HEIC'),
      'image/heic'
    );
  });

  test('an absent type falls back to the extension, case-insensitively', () => {
    assert.strictEqual(resolveContentType('', 'clip.MOV'), 'video/quicktime');
    assert.strictEqual(resolveContentType(undefined, 'photo.PNG'), 'image/png');
  });

  test("'application/mp4' — which the client accepts and the old server did not", () => {
    assert.strictEqual(resolveContentType('application/mp4', 'clip.mp4'), 'video/mp4');
  });

  test('a genuinely unsupported file is still refused', () => {
    assert.strictEqual(resolveContentType('application/pdf', 'contract.pdf'), null);
    assert.strictEqual(resolveContentType('', 'notes.txt'), null);
    assert.strictEqual(resolveContentType('application/octet-stream', 'payload'), null);
  });

  test('a hostile content type is never passed through to storage', () => {
    // This is why the fallback resolves a type rather than accepting the
    // declared one: whatever is returned here is signed into the presigned URL
    // and is what R2 serves from the public bucket host. Honouring 'text/html'
    // would be stored XSS on our own domain.
    assert.strictEqual(resolveContentType('text/html', 'evil.jpg'), 'image/jpeg');
    assert.strictEqual(resolveContentType('text/html', 'evil.html'), null);
    assert.strictEqual(
      resolveContentType('application/javascript', 'evil.js'),
      null
    );
  });
});

// --------------------------------------------------------------------------
// 3. The backfill normalises exactly the way createEvent does
// --------------------------------------------------------------------------

describe('the organizerEmail backfill agrees with the write path', () => {
  // The backfill repairs events created before createEvent started normalising.
  // If the two definitions of "normalised" ever drift, the backfill rewrites
  // documents into a form the dashboard query still will not match — quietly
  // re-breaking the thing it exists to fix.
  const { normalise } = require('../scripts/backfill-organizer-email.js');

  test('trims and lowercases, matching photoService.createEvent', () => {
    assert.strictEqual(normalise('  Sarah.Jones@Gmail.com '), 'sarah.jones@gmail.com');
    assert.strictEqual(normalise('ALL@CAPS.COM'), 'all@caps.com');
    assert.strictEqual(normalise('already@fine.com'), 'already@fine.com');
  });

  test('is idempotent — a second run finds nothing to change', () => {
    const once = normalise(' Mixed@Case.Com ');
    assert.strictEqual(normalise(once), once);
  });

  test('createEvent still normalises the same way', () => {
    // Asserted against the source rather than by executing it: createEvent
    // writes to Firestore, and the property under test is the transform, not
    // the write.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'photoService.ts'),
      'utf8'
    );

    assert.match(
      source,
      /organizerEmail\.trim\(\)\.toLowerCase\(\)/,
      'createEvent no longer trims-and-lowercases — scripts/backfill-organizer-email.js ' +
        'must be updated to match, or it will write a form the dashboard query cannot find'
    );
  });
});

describe('client and server accept the same extensions', () => {
  // The parity guard. mediaUploadService.ts decides what the guest is allowed to
  // pick; upload-init decides what the server will sign for. If someone adds an
  // extension to one list and not the other, uploads fail at the seam again —
  // which is exactly how this finding came about.
  test('every extension the client accepts, the server resolves', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'mediaUploadService.ts'),
      'utf8'
    );

    // Both client fallbacks are extension alternations in a regex literal.
    const alternations = [...source.matchAll(/\\\.\(([a-z0-9|]+)\)\$/g)].map((m) => m[1]);

    assert.ok(
      alternations.length >= 2,
      'expected the video and image extension fallbacks in mediaUploadService.ts — ' +
        'if this fails the client changed shape and this parity check needs updating'
    );

    const clientExtensions = alternations.flatMap((group) => group.split('|'));

    for (const ext of clientExtensions) {
      assert.notStrictEqual(
        resolveContentType('application/octet-stream', `file.${ext}`),
        null,
        `the client accepts .${ext} but upload-init would reject it`
      );
    }
  });
});
