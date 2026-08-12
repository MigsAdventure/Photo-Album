/**
 * ZIP entry handling for the wedding photo processor.
 *
 * Extracted from the processor so it can be tested without AWS credentials or a
 * live R2 bucket. This module contains the fix for finding ZIP-3 — the cause of
 * the large-video archive failures — and tests/archive-entries.test.js proves
 * the sequential behaviour it depends on.
 */

const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const pipelineAsync = pipeline;

/**
 * Make a filename safe to put in a ZIP entry.
 *
 * Entry names went in raw. A name containing path separators or '..' produces an
 * archive that writes outside the extraction directory on some tools ("zip
 * slip"), and guest filenames come from phones we do not control. The Netlify
 * path sanitised; this one never did.
 */
function safeEntryName(fileName, index) {
  // Deny the characters that actually cause problems rather than allowing a
  // narrow set. An allowlist of [\w.\- ] looks safer but mangles ordinary
  // filenames — "IMG 0001 (1).jpg" became "IMG 0001 _1_.jpg", which is a worse
  // experience for the customer than the risk it avoided. Parentheses, brackets,
  // commas and apostrophes are all fine in a ZIP entry.
  //
  // What is not fine: path separators, control characters, and the set Windows
  // rejects outright, which would make the archive unextractable there.
  const base = String(fileName || '')
    .split(/[\\/]/).pop()            // strip any directory component
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')              // no leading dots, so no '..' and no hidden files
    .trim();

  return base.length > 0 ? base.slice(0, 200) : `file_${index + 1}`;
}

/**
 * Give every entry a distinct name.
 *
 * Phone cameras reuse filenames constantly — twenty guests can each contribute an
 * IMG_0001.jpg. Duplicate entries in a ZIP are legal but most extractors either
 * overwrite silently or prompt, so photos were being lost at extraction time
 * without anything in our logs. It also matters for correctness now: the drain
 * below matches archiver's 'entry' event by name, which needs names to be unique.
 */
function uniqueEntryName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n++;
    candidate = `${stem} (${n})${ext}`;
  }

  used.add(candidate);
  return candidate;
}

/**
 * Append one entry and wait until archiver has finished consuming it.
 *
 * THIS IS THE CORE OF THE LARGE-VIDEO FIX (finding ZIP-3).
 *
 * The original loop fetched every file and called archive.append() on each live
 * response stream without waiting. archiver processes entries strictly in order,
 * one at a time, so with 30 files you had 30 open HTTPS connections, 29 of them
 * idle while the first was compressed and uploaded. Google Cloud Storage closes
 * idle connections, so a 400 MB video sitting 25th in the queue could wait
 * minutes before archiver reached it, by which point its socket was dead.
 *
 * Awaiting the 'entry' event means exactly one file is in flight at a time.
 */
function appendAndDrain(archive, source, entryName) {
  return new Promise((resolve, reject) => {
    const onEntry = (entry) => {
      if (entry.name === entryName) {
        cleanup();
        resolve();
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      archive.removeListener('entry', onEntry);
      archive.removeListener('error', onError);
      source.removeListener('error', onError);
    }

    archive.on('entry', onEntry);
    archive.on('error', onError);

    // A source that dies mid-read must reject this promise. Without it the
    // failure is silent in the worst possible way — see the note on
    // downloadToTempFile below.
    source.on('error', onError);

    archive.append(source, { name: entryName, date: new Date() });
  });
}

/**
 * Download to a local file first, retrying, then hand archiver something that
 * cannot fail underneath it.
 *
 * WHY NOT STREAM THE RESPONSE STRAIGHT INTO THE ARCHIVE
 * -----------------------------------------------------
 * That was the first version of this fix, and it was wrong in a way the tests
 * did not catch, because the tests only ever simulated a *clean* HTTP error.
 * When an origin accepts a request and then drops the socket part-way through
 * the body — which is exactly what Firebase/GCS does, and the whole reason
 * ZIP-3 exists — piping the response into archiver produces one of two
 * outcomes, both bad:
 *
 *   1. No error listener on the source: the Readable emits 'error'
 *      ("terminated" / SocketError: other side closed) with nothing handling
 *      it, so Node raises uncaughtException. The processor's handler calls
 *      process.exit(1), and ONE dropped connection kills the entire archive
 *      job rather than costing one file.
 *
 *   2. With an error listener: the error is observed, but archiver emits
 *      neither 'entry' nor 'error' for that append — the entry is simply
 *      abandoned mid-write. appendAndDrain never settles, and the job hangs
 *      until the one-hour ceiling in the processor.
 *
 * Either way the per-file retry below was unreachable for the precise failure
 * it was written to handle. Both were reproduced against a server that destroys
 * the socket mid-body; tests/archive-entries.test.js now covers it.
 *
 * Downloading to a temp file first makes retry meaningful: nothing has been
 * committed to the archive yet, so a failed attempt costs only the bytes so
 * far. Archiver then reads a complete local file, which cannot drop. Memory
 * stays bounded — this streams to disk, it does not buffer — and disk use is
 * bounded by one file at a time.
 */
async function downloadToTempFile(photo, tmpDir, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const sizeMB = (photo.size || 0) / (1024 * 1024);

  // Scale the budget to the file. A 500 MB video over a slow origin legitimately
  // takes minutes; a photo that takes minutes is stuck.
  const timeoutMs = Math.min(60_000 + (sizeMB / 100) * 20_000, 15 * 60_000);

  const tmpPath = path.join(tmpDir, `entry-${process.pid}-${Date.now()}-${attempt}.part`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(photo.url, { signal: controller.signal });

    if (!response.ok) {
      // 4xx means the object is gone or the URL is malformed — retrying cannot
      // change that. 5xx and transport failures are worth another attempt.
      throw Object.assign(new Error(`HTTP ${response.status} fetching ${photo.fileName}`), {
        retryable: response.status >= 500,
      });
    }

    // pipeline() propagates a mid-body socket death as a rejection here, where
    // it is catchable, rather than as an unhandled stream error.
    await pipelineAsync(Readable.fromWeb(response.body), fs.createWriteStream(tmpPath));

    return tmpPath;
  } catch (error) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});

    const retryable = error.retryable !== false;

    if (retryable && attempt < MAX_ATTEMPTS) {
      const backoffMs = 2000 * attempt;
      console.warn(
        `Retry ${attempt + 1}/${MAX_ATTEMPTS} for ${photo.fileName} after ${error.message} (waiting ${backoffMs}ms)`
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return downloadToTempFile(photo, tmpDir, attempt + 1);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch one file and add it to the archive.
 *
 * Returns {ok:true} or {ok:false, error} — a single unrecoverable file never
 * throws, so one bad object cannot take down a whole wedding's archive. The
 * caller tracks the failure count and refuses to report success if too many
 * files are missing (finding ZIP-7).
 */
async function addFileToArchive(archive, photo, entryName, tmpDir = os.tmpdir()) {
  let tmpPath;

  try {
    tmpPath = await downloadToTempFile(photo, tmpDir);
    await appendAndDrain(archive, fs.createReadStream(tmpPath), entryName);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (tmpPath) {
      // Delete as we go. The instance root volume is small, and a wedding
      // archive can be several gigabytes in total even though no single file is.
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
    }
  }
}

module.exports = { safeEntryName, uniqueEntryName, appendAndDrain, addFileToArchive, downloadToTempFile };
