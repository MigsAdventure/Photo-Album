/**
 * Archive entry tests — the fix for finding ZIP-3.
 *
 * The large-video failures were a queueing bug, not a size bug: the old loop
 * appended every file's live HTTP response to archiver without waiting, and
 * archiver drains entries one at a time, so most connections sat idle until the
 * origin closed them.
 *
 * The load-bearing assertion here is `never opens more than one connection at a
 * time`. It runs against a real local HTTP server that tracks concurrency and
 * streams slowly enough that overlap would be obvious, so it fails against the
 * old implementation and passes against the new one.
 *
 * Run with: npm run test:archive
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const archiver = require('archiver');
const { Writable } = require('stream');

const {
  safeEntryName,
  uniqueEntryName,
  addFileToArchive,
} = require('../aws-ec2-spot/archive-entries');

// --------------------------------------------------------------- test server

let server;
let baseUrl;

/** Live connections right now, and the high-water mark across the whole run. */
const connections = { current: 0, peak: 0 };

/** Requests that should fail, and how many times each has been attempted. */
const failures = new Map();

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname.slice(1);

    // Simulated transient failure: fail the first N attempts, then succeed.
    if (failures.has(name)) {
      const state = failures.get(name);
      state.attempts++;
      if (state.attempts <= state.failTimes) {
        res.writeHead(state.status || 500);
        res.end('simulated failure');
        return;
      }
    }

    connections.current++;
    connections.peak = Math.max(connections.peak, connections.current);

    const chunks = Number(url.searchParams.get('chunks') || 4);
    const delayMs = Number(url.searchParams.get('delay') || 25);

    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });

    // Dribble the body out. If two downloads were ever in flight together, the
    // concurrency counter would catch them here.
    for (let i = 0; i < chunks; i++) {
      res.write(Buffer.alloc(1024, i % 256));
      await new Promise((r) => setTimeout(r, delayMs));
    }

    connections.current--;
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

/** Collect an archive into a sink and report the entries archiver emitted. */
function makeArchive() {
  const archive = archiver('zip', { zlib: { level: 1 }, statConcurrency: 1 });
  const entries = [];
  let bytes = 0;

  archive.on('entry', (entry) => entries.push(entry.name));
  archive.pipe(
    new Writable({
      write(chunk, _enc, cb) {
        bytes += chunk.length;
        cb();
      },
    })
  );

  return { archive, entries, size: () => bytes };
}

function photo(name, { chunks = 4, delay = 25, size = 1024 } = {}) {
  return { fileName: name, url: `${baseUrl}/${name}?chunks=${chunks}&delay=${delay}`, size };
}

// ------------------------------------------------------------------- naming

describe('entry names', () => {
  test('strips directory components', () => {
    assert.strictEqual(safeEntryName('holiday/IMG_1.jpg', 0), 'IMG_1.jpg');
    assert.strictEqual(safeEntryName('C:\\photos\\IMG_2.jpg', 0), 'IMG_2.jpg');
  });

  test('neutralises path traversal', () => {
    const name = safeEntryName('../../../etc/passwd', 0);
    assert.ok(!name.includes('..'), `"${name}" still contains ..`);
    assert.ok(!name.includes('/'), `"${name}" still contains a separator`);
  });

  test('replaces characters that break extractors', () => {
    assert.strictEqual(safeEntryName('a:b*c?d.jpg', 0), 'a_b_c_d.jpg');
  });

  test('falls back to a positional name when nothing usable is left', () => {
    assert.strictEqual(safeEntryName('', 4), 'file_5');
    assert.strictEqual(safeEntryName('...', 0), 'file_1');
  });

  test('caps absurdly long names', () => {
    assert.ok(safeEntryName('x'.repeat(500) + '.jpg', 0).length <= 200);
  });

  test('keeps ordinary phone filenames intact', () => {
    assert.strictEqual(safeEntryName('IMG_0001.HEIC', 0), 'IMG_0001.HEIC');
    assert.strictEqual(safeEntryName('IMG 0001 (1).jpg', 0), 'IMG 0001 (1).jpg');
  });
});

describe('duplicate names', () => {
  test('twenty guests each uploading IMG_0001.jpg all survive', () => {
    const used = new Set();
    const names = Array.from({ length: 20 }, () => uniqueEntryName('IMG_0001.jpg', used));

    assert.strictEqual(new Set(names).size, 20, 'every name must be distinct');
    assert.strictEqual(names[0], 'IMG_0001.jpg', 'the first keeps its name');
    assert.strictEqual(names[1], 'IMG_0001 (2).jpg');
  });

  test('the suffix goes before the extension, not after', () => {
    const used = new Set(['clip.mp4']);
    assert.strictEqual(uniqueEntryName('clip.mp4', used), 'clip (2).mp4');
  });

  test('handles names with no extension', () => {
    const used = new Set(['README']);
    assert.strictEqual(uniqueEntryName('README', used), 'README (2)');
  });
});

// --------------------------------------------------------- the ZIP-3 fix

describe('sequential streaming (ZIP-3)', () => {
  test('never opens more than one connection at a time', async () => {
    connections.current = 0;
    connections.peak = 0;

    const { archive, entries } = makeArchive();
    const files = Array.from({ length: 8 }, (_, i) =>
      photo(`IMG_${i}.jpg`, { chunks: 6, delay: 15 })
    );

    for (let i = 0; i < files.length; i++) {
      const result = await addFileToArchive(archive, files[i], `IMG_${i}.jpg`);
      assert.strictEqual(result.ok, true, `file ${i} should have been added`);
    }
    await archive.finalize();

    // The whole point. The old implementation would peak at 8 here.
    assert.strictEqual(
      connections.peak,
      1,
      `expected one connection at a time, saw ${connections.peak} concurrent`
    );
    assert.strictEqual(entries.length, 8, 'every file should be in the archive');
  });

  test('a slow file does not starve the ones queued behind it', async () => {
    const { archive, entries } = makeArchive();

    // A large slow file first, then small ones. Under the old implementation the
    // small files' sockets idled while this one drained, which is where they died.
    await addFileToArchive(archive, photo('big.mp4', { chunks: 20, delay: 10 }), 'big.mp4');
    await addFileToArchive(archive, photo('small1.jpg'), 'small1.jpg');
    await addFileToArchive(archive, photo('small2.jpg'), 'small2.jpg');
    await archive.finalize();

    assert.deepStrictEqual(entries, ['big.mp4', 'small1.jpg', 'small2.jpg']);
  });

  test('entries come out in the order they went in', async () => {
    const { archive, entries } = makeArchive();
    const names = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];

    for (const name of names) {
      await addFileToArchive(archive, photo(name, { chunks: 2, delay: 5 }), name);
    }
    await archive.finalize();

    assert.deepStrictEqual(entries, names);
  });

  test('the archive has real content in it', async () => {
    const { archive, size } = makeArchive();
    await addFileToArchive(archive, photo('one.jpg', { chunks: 10 }), 'one.jpg');
    await archive.finalize();
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(size() > 0, 'archive should not be empty');
  });
});

// ------------------------------------------------------------------ retries

describe('failure handling', () => {
  test('retries a transient 500 and recovers', async () => {
    failures.set('flaky.jpg', { attempts: 0, failTimes: 2, status: 500 });

    const { archive, entries } = makeArchive();
    const result = await addFileToArchive(archive, photo('flaky.jpg'), 'flaky.jpg');
    await archive.finalize();

    assert.strictEqual(result.ok, true, 'should recover on the third attempt');
    assert.deepStrictEqual(entries, ['flaky.jpg']);

    failures.delete('flaky.jpg');
  });

  test('does not retry a 404 — the object is gone', async () => {
    failures.set('missing.jpg', { attempts: 0, failTimes: 99, status: 404 });

    const started = Date.now();
    const { archive } = makeArchive();
    const result = await addFileToArchive(archive, photo('missing.jpg'), 'missing.jpg');
    archive.abort();

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /404/);
    // Retrying with backoff would take seconds; refusing takes milliseconds.
    assert.ok(Date.now() - started < 1500, 'should fail fast rather than back off');

    failures.delete('missing.jpg');
  });

  test('gives up after the retry budget and reports why', async () => {
    failures.set('broken.jpg', { attempts: 0, failTimes: 99, status: 503 });

    const { archive } = makeArchive();
    const result = await addFileToArchive(archive, photo('broken.jpg'), 'broken.jpg');
    archive.abort();

    assert.strictEqual(result.ok, false);
    assert.ok(result.error.length > 0, 'should say what went wrong');

    failures.delete('broken.jpg');
  });

  test('one bad file does not stop the rest of the collection', async () => {
    failures.set('bad.jpg', { attempts: 0, failTimes: 99, status: 404 });

    const { archive, entries } = makeArchive();
    const results = [];

    for (const name of ['ok1.jpg', 'bad.jpg', 'ok2.jpg']) {
      results.push(await addFileToArchive(archive, photo(name), name));
    }
    await archive.finalize();

    assert.deepStrictEqual(results.map((r) => r.ok), [true, false, true]);
    assert.deepStrictEqual(entries, ['ok1.jpg', 'ok2.jpg']);

    failures.delete('bad.jpg');
  });
});
