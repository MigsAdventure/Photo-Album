/**
 * ZIP entry handling for the wedding photo processor.
 *
 * Extracted from the processor so it can be tested without AWS credentials or a
 * live R2 bucket. This module contains the fix for finding ZIP-3 — the cause of
 * the large-video archive failures — and tests/archive-entries.test.js proves
 * the sequential behaviour it depends on.
 */

const { Readable } = require('stream');

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
 * THIS IS THE FIX FOR THE LARGE-VIDEO FAILURES (finding ZIP-3).
 *
 * The previous loop fetched every file and called archive.append() on each live
 * response stream without waiting. archiver processes entries strictly in order,
 * one at a time, so with 30 files you ended up with 30 open Firebase HTTPS
 * connections, 29 of them idle while the first was compressed and uploaded.
 * Google Cloud Storage closes idle connections. A 400 MB video sitting 25th in
 * the queue could wait several minutes before archiver reached it, by which
 * point its socket was dead — the entry silently truncated, or the whole job
 * errored mid-archive. It degraded exactly in proportion to file size and count,
 * which is why it looked like "big videos break" rather than a queueing bug.
 *
 * Awaiting the 'entry' event means exactly one connection is open at a time and
 * every byte is consumed as it arrives.
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
    }

    archive.on('entry', onEntry);
    archive.on('error', onError);

    archive.append(source, { name: entryName, date: new Date() });
  });
}

/**
 * Fetch one file and add it to the archive, retrying on transport failures.
 *
 * The timeout wraps the whole fetch-and-drain cycle rather than just the fetch.
 * Previously an AbortController was armed at fetch time with a two-minute
 * budget, then the file might sit in archiver's queue for longer than that — so
 * the abort fired on files that had downloaded perfectly well and were only
 * waiting their turn. With a sequential loop there is no queue wait, and the
 * timeout now measures the thing it is supposed to measure.
 */
async function addFileToArchive(archive, photo, entryName, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const sizeMB = (photo.size || 0) / (1024 * 1024);

  // Scale the budget to the file. A 500 MB video over a slow origin legitimately
  // takes minutes; a photo that takes minutes is stuck. Floor of 60s, plus 20s
  // per 100 MB, capped at 15 minutes.
  const timeoutMs = Math.min(60_000 + (sizeMB / 100) * 20_000, 15 * 60_000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(photo.url, { signal: controller.signal });

    if (!response.ok) {
      // 4xx means the object is gone or the URL is malformed — retrying will not
      // change that. 5xx and network errors are worth another attempt.
      const retryable = response.status >= 500;
      throw Object.assign(
        new Error(`HTTP ${response.status} fetching ${photo.fileName}`),
        { retryable }
      );
    }

    await appendAndDrain(archive, Readable.fromWeb(response.body), entryName);
    return { ok: true };
  } catch (error) {
    const retryable = error.retryable !== false;

    if (retryable && attempt < MAX_ATTEMPTS) {
      const backoffMs = 2000 * attempt;
      console.warn(
        `Retry ${attempt + 1}/${MAX_ATTEMPTS} for ${photo.fileName} after ${error.message} (waiting ${backoffMs}ms)`
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return addFileToArchive(archive, photo, entryName, attempt + 1);
    }

    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { safeEntryName, uniqueEntryName, appendAndDrain, addFileToArchive };
