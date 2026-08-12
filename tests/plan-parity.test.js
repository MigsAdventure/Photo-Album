/**
 * Upload-window rules: behaviour, and client/server parity (finding UX-1).
 *
 * The rules exist twice — netlify/functions/_lib/plan.js decides, and
 * src/services/planService.ts explains the decision in the UI before a guest
 * picks a file. Two copies of a rule drift, and the failure here is quiet: the
 * UI invites an upload the server then rejects, or hides one it would have
 * accepted. So the parity block below runs both implementations over the same
 * cases and asserts they agree.
 *
 * The client copy is TypeScript, so it is transpiled here with the TypeScript
 * compiler that is already a dependency. An earlier version of this file stripped
 * the annotations with regexes and broke on the first non-trivial signature —
 * transpiling is both more honest and less work.
 *
 * Run with: npm run test:plan
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const server = require('../netlify/functions/_lib/plan');

// --------------------------------------------------- load the client copy

function loadClientPlanService() {
  const ts = require('typescript');

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'planService.ts'),
    'utf8'
  );

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'planService.ts',
  });

  // planService.ts imports only a type (Event), which transpiles away — so the
  // emitted module has no runtime dependencies and can be evaluated directly.
  const mod = new Module('planService');
  mod._compile(outputText, path.join(__dirname, '..', 'src', 'services', 'planService.js'));
  return mod.exports;
}

let client;
try {
  client = loadClientPlanService();
} catch (error) {
  throw new Error(
    `Could not load src/services/planService.ts for the parity check: ${error.message}\n` +
      'If the file grew syntax the stripper cannot handle, compile it instead of removing this test.'
  );
}

// ------------------------------------------------------------- fixtures

const NOW = new Date('2026-06-20T12:00:00Z');

function event(overrides = {}) {
  return {
    date: '2026-06-14',
    createdAt: new Date('2026-05-01T10:00:00Z'),
    planType: 'free',
    photoCount: 0,
    isActive: true,
    ...overrides,
  };
}

// Each case is [description, event, now].
const CASES = [
  ['a free event during its window', event({ date: '2026-06-20' }), NOW],
  ['a free event on the day', event({ date: '2026-06-20' }), NOW],
  ['a free event one day after', event({ date: '2026-06-19' }), NOW],
  ['a free event well past its window', event({ date: '2026-06-14' }), NOW],
  ['a premium event past the same window', event({ date: '2026-06-14', planType: 'premium' }), NOW],
  ['a premium event with many photos', event({ planType: 'premium', photoCount: 4000 }), NOW],
  ['an event at the abuse ceiling', event({ planType: 'premium', photoCount: 5000 }), NOW],
  ['a free event at the abuse ceiling', event({ date: '2026-06-20', photoCount: 5000 }), NOW],
  ['a deactivated event', event({ date: '2026-06-20', isActive: false }), NOW],
  ['an event created for a future date', event({ date: '2026-12-25' }), NOW],
  ['an event with no date', event({ date: undefined }), NOW],
  ['an event with a malformed date', event({ date: 'not-a-date' }), NOW],
  ['an event whose date is before it was created', event({ date: '2020-01-01' }), NOW],
  ['an event with 200 photos in window', event({ date: '2026-06-20', photoCount: 200 }), NOW],
];

// ------------------------------------------------------------- behaviour

describe('upload window behaviour', () => {
  test('a free event accepts uploads on the day', () => {
    const state = server.getUploadState(event({ date: '2026-06-20' }), NOW);
    assert.strictEqual(state.canUpload, true);
    assert.strictEqual(state.reason, 'ok');
  });

  test('a free event stays open the morning after', () => {
    // The whole point of a 72-hour window: people upload when they wake up.
    const state = server.getUploadState(event({ date: '2026-06-19' }), NOW);
    assert.strictEqual(state.canUpload, true);
  });

  test('a free event closes once the window passes', () => {
    const state = server.getUploadState(event({ date: '2026-06-14' }), NOW);
    assert.strictEqual(state.canUpload, false);
    assert.strictEqual(state.reason, 'window_closed');
  });

  test('the 200th photo is accepted — there is no small count limit any more', () => {
    // The bug this finding is about: guest number three used to be blocked.
    const state = server.getUploadState(event({ date: '2026-06-20', photoCount: 200 }), NOW);
    assert.strictEqual(state.canUpload, true);
  });

  test('premium ignores the window entirely', () => {
    const state = server.getUploadState(
      event({ date: '2020-01-01', planType: 'premium' }),
      NOW
    );
    assert.strictEqual(state.canUpload, true);
  });

  test('the abuse ceiling applies even to premium', () => {
    const state = server.getUploadState(
      event({ planType: 'premium', photoCount: server.ABUSE_CEILING }),
      NOW
    );
    assert.strictEqual(state.canUpload, false);
    assert.strictEqual(state.reason, 'ceiling');
  });

  test('a gallery set up weeks ahead is open immediately', () => {
    // Planners create galleries long before the event. A window measured from
    // creation would be shut before the first guest arrived.
    const state = server.getUploadState(
      event({ date: '2026-12-25', createdAt: new Date('2026-05-01') }),
      NOW
    );
    assert.strictEqual(state.canUpload, true);
  });

  test('a missing date falls back to creation time rather than throwing', () => {
    const state = server.getUploadState(
      event({ date: undefined, createdAt: new Date('2026-06-19T12:00:00Z') }),
      NOW
    );
    assert.strictEqual(state.canUpload, true);
    assert.ok(state.closesAt instanceof Date);
  });

  test('a malformed date falls back to creation time', () => {
    const state = server.getUploadState(
      event({ date: 'not-a-date', createdAt: new Date('2026-01-01') }),
      NOW
    );
    assert.strictEqual(state.canUpload, false);
    assert.strictEqual(state.reason, 'window_closed');
  });

  test('a deactivated event accepts nothing', () => {
    const state = server.getUploadState(event({ isActive: false }), NOW);
    assert.strictEqual(state.reason, 'inactive');
  });
});

describe('what we tell people', () => {
  test('a guest is never asked to upgrade', () => {
    const closed = server.getUploadState(event({ date: '2026-06-14' }), NOW);
    const message = server.explainUploadState(closed, 'guest');

    assert.doesNotMatch(message, /upgrade/i, 'guests must not be asked to pay');
    assert.match(message, /download|browse/i, 'tell them what they can still do');
  });

  test('the organizer is the one offered the upgrade', () => {
    const closed = server.getUploadState(event({ date: '2026-06-14' }), NOW);
    assert.match(server.explainUploadState(closed, 'organizer'), /upgrade/i);
  });

  test('an open event has nothing to say', () => {
    const open = server.getUploadState(event({ date: '2026-06-20' }), NOW);
    assert.strictEqual(server.explainUploadState(open, 'guest'), null);
  });
});

// ---------------------------------------------------------------- parity

describe('client and server agree', () => {
  test('the constants match', () => {
    assert.strictEqual(client.FREE_UPLOAD_WINDOW_HOURS, server.FREE_UPLOAD_WINDOW_HOURS);
    assert.strictEqual(client.ABUSE_CEILING, server.ABUSE_CEILING);
  });

  for (const [description, evt, now] of CASES) {
    test(`same decision for ${description}`, () => {
      const s = server.getUploadState(evt, now);
      const c = client.getUploadState(evt, now);

      assert.strictEqual(
        c.canUpload,
        s.canUpload,
        `canUpload disagrees: client ${c.canUpload}, server ${s.canUpload}`
      );
      assert.strictEqual(
        c.reason,
        s.reason,
        `reason disagrees: client "${c.reason}", server "${s.reason}"`
      );
      assert.strictEqual(
        c.closesAt ? c.closesAt.getTime() : null,
        s.closesAt ? s.closesAt.getTime() : null,
        'closesAt disagrees'
      );
    });
  }

  test('the same wording, so the two never contradict each other on screen', () => {
    for (const [, evt, now] of CASES) {
      const s = server.getUploadState(evt, now);
      const c = client.getUploadState(evt, now);

      for (const audience of ['guest', 'organizer']) {
        assert.strictEqual(
          client.explainUploadState(c, audience),
          server.explainUploadState(s, audience),
          `wording disagrees for a ${audience}`
        );
      }
    }
  });
});
