/**
 * Request an archive of an event's media, delivered by email.
 *
 * This is now the ONLY entry point for bulk downloads. It validates, rate
 * limits, reads the collection from Firestore, and enqueues one job. It does not
 * archive anything itself.
 *
 * What this replaces (findings ZIP-1, ZIP-2, ZIP-4)
 * ------------------------------------------------
 * A request used to traverse up to four independent routers, each with its own
 * size threshold, its own rate limiter, and its own fallback:
 *
 *   browser (>80MB video / >500MB / >10 videos)  -> Google Cloud Run
 *   this function (>50MB)                        -> Cloudflare Worker
 *   the Worker (>80MB any file or total)         -> AWS Lambda
 *   the Lambda (no threshold)                    -> SQS -> EC2
 *
 * The thresholds disagreed, so identical collections took different paths
 * depending on which entry point saw them first, and a 60 MB photo collection
 * was "large" to this function and "small" to the Worker, so it ping-ponged.
 *
 * Worse, two of those hops could not work at all. Google Cloud Run was
 * decommissioned in January 2025 but the frontend still called it, burning a
 * full 30-second timeout before falling back. And this function's own fallback
 * called processLargeCollectionInBackground() without awaiting it and then
 * returned - Netlify freezes the container the moment a response is sent, and
 * real background work needs a filename ending in "-background", which none of
 * these have. So whenever the Worker was unreachable the customer was told
 * "you'll receive an email in 3-8 minutes" and received nothing: no email, no
 * error, no log line.
 *
 * Now: browser -> here -> Lambda -> SQS -> EC2. One threshold table, which is
 * to say none, because every collection takes the same path.
 *
 * The tradeoff, stated plainly: a five-photo collection now waits for an EC2
 * instance to start (roughly 60-90 seconds cold) instead of being zipped inline.
 * That is acceptable because delivery is by email either way - the customer is
 * not watching a progress bar - and it removes an entire class of failure in
 * exchange. If the wait ever becomes a product problem, the answer is a warm
 * worker, not a second code path.
 *
 * Refs: AUDIT_2026-08.md ZIP-1, ZIP-2, ZIP-4, SEC-4, SEC-8
 */

const { getDb, isConfigured, FieldValue } = require('./_lib/firebase-admin');
const { requireInternalCaller, isAllowedDownloadUrl } = require('./_lib/internal-auth');
const { checkDownloadRequest } = require('./_lib/rate-limit');
const { sendArchiveReadyEmail } = require('./_lib/emails');

// How long a completed archive is reused instead of building a new one. Guests
// commonly request a download two or three times in quick succession, and each
// rebuild is a full EC2 job over the same bytes.
const ARCHIVE_REUSE_WINDOW_MS = Number(process.env.ARCHIVE_REUSE_WINDOW_MS || 30 * 60 * 1000);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-sharedmoments-internal',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { ...CORS, ...extraHeaders }, body: JSON.stringify(body) };
}

/**
 * Read the collection from Firestore.
 *
 * The photo list is read here rather than accepted from the caller. The old
 * frontend analysed the collection in the browser and posted the resulting
 * array onward, which meant a client could nominate arbitrary URLs to be fetched
 * by our processor and packaged into an archive we then email out.
 */
async function loadCollection(db, eventId) {
  const snapshot = await db.collection('photos').where('eventId', '==', eventId).get();

  const photos = [];
  let totalBytes = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.url) return;

    photos.push({
      id: doc.id,
      fileName: data.fileName || `photo_${doc.id}.jpg`,
      url: data.url,
      size: data.size || 0,
      mediaType: data.mediaType || 'photo',
    });
    totalBytes += data.size || 0;
  });

  return { photos, totalBytes };
}

/**
 * Has this event been archived recently enough to reuse?
 *
 * Archive keys are unique per job now (ZIP-6), so a completed archive stays
 * valid at its own URL and can safely be handed to a second requester.
 */
async function findRecentArchive(db, eventId) {
  const doc = await db.collection('downloadJobs').doc(`archive_${eventId}`).get();
  if (!doc.exists) return null;

  const data = doc.data();
  if (!data.downloadUrl || !data.completedAt) return null;

  const age = Date.now() - data.completedAt.toMillis();
  if (age > ARCHIVE_REUSE_WINDOW_MS) return null;

  return data;
}

/** Hand the job to the launcher, which queues it and starts a processor. */
async function enqueueJob({ eventId, email, photos, requestId }) {
  const launcherUrl = process.env.AWS_LAMBDA_URL;
  const secret = process.env.LAUNCHER_SHARED_SECRET;

  if (!launcherUrl) throw new Error('AWS_LAMBDA_URL is not configured');
  if (!secret) throw new Error('LAUNCHER_SHARED_SECRET is not configured');

  const response = await fetch(launcherUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sharedmoments-secret': secret,
    },
    body: JSON.stringify({ eventId, email, photos, requestId }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Launcher returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  return response.json();
}

exports.handler = async (event) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed', requestId });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON in request body', requestId });
  }

  const { eventId, email, source, downloadUrl, fileCount, finalSizeMB, failedCount } = body;

  // ------------------------------------------------ processor callback branch
  //
  // The EC2 processor calls back here when an archive is ready. This sends a
  // branded email containing a caller-supplied link, so it requires the internal
  // secret and the link must be on our own R2 host (finding SEC-8).
  if (source === 'processor' || source === 'cloudflare-worker') {
    const unauthorised = requireInternalCaller(event, CORS);
    if (unauthorised) return unauthorised;

    if (!isAllowedDownloadUrl(downloadUrl)) {
      console.error(`Rejected callback download URL [${requestId}]`);
      return json(400, {
        error: 'downloadUrl must be an https link on the configured R2 host',
        requestId,
      });
    }

    if (!email) {
      return json(400, { error: 'email is required', requestId });
    }

    try {
      // failedCount has to be forwarded, not just accepted. The processor counts
      // the files it could not fetch and sends the number here; dropping it on
      // the floor meant the "some files are missing" notice built for ZIP-7
      // could never render, and a short archive arrived looking complete.
      await sendArchiveReadyEmail({
        email,
        downloadUrl,
        fileCount,
        finalSizeMB,
        failedCount: Number(failedCount) || 0,
        requestId,
      });

      // Record it so a repeat request within the reuse window gets this URL back
      // instead of starting another job.
      if (eventId && isConfigured()) {
        await getDb().collection('downloadJobs').doc(`archive_${eventId}`).set(
          {
            eventId,
            downloadUrl,
            fileCount: fileCount || null,
            finalSizeMB: finalSizeMB || null,
            failedCount: Number(failedCount) || 0,
            completedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return json(200, { success: true, requestId });
    } catch (error) {
      console.error(`Failed to send archive email [${requestId}]:`, error);
      return json(500, { error: 'Failed to send email', requestId });
    }
  }

  // ------------------------------------------------------ customer request
  if (!eventId || !email) {
    return json(400, { error: 'eventId and email are required', requestId });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'That email address does not look right', requestId });
  }

  if (!isConfigured()) {
    console.error(`FIREBASE_SERVICE_ACCOUNT is not set [${requestId}]`);
    return json(500, { error: 'Downloads are unavailable right now. Please try again later.', requestId });
  }

  try {
    const rateCheck = await checkDownloadRequest(eventId, email);
    if (!rateCheck.allowed) {
      return json(
        429,
        {
          error: rateCheck.reason,
          action: `Please wait about ${Math.ceil(rateCheck.retryAfterSeconds / 60)} minute(s) and try again. Your photos are safe — nothing was lost.`,
          retryAfterSeconds: rateCheck.retryAfterSeconds,
          requestId,
        },
        { 'Retry-After': String(rateCheck.retryAfterSeconds) }
      );
    }

    const db = getDb();

    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return json(404, { error: 'That event could not be found', requestId });
    }

    const { photos, totalBytes } = await loadCollection(db, eventId);

    if (photos.length === 0) {
      return json(404, {
        error: 'There are no photos in this event yet',
        requestId,
      });
    }

    const totalSizeMB = totalBytes / (1024 * 1024);

    // Reuse a recent archive rather than rebuilding the same bytes.
    const existing = await findRecentArchive(db, eventId);
    if (existing) {
      console.log(`Reusing recent archive for ${eventId} [${requestId}]`);
      await sendArchiveReadyEmail({
        email,
        downloadUrl: existing.downloadUrl,
        fileCount: existing.fileCount || photos.length,
        finalSizeMB: existing.finalSizeMB || totalSizeMB,
        // The reused archive is the same bytes, so it is short by the same
        // files. Reading the count back keeps the second email as honest as the
        // first rather than quietly dropping the notice on the reuse path.
        failedCount: Number(existing.failedCount) || 0,
        requestId,
      });

      return json(200, {
        success: true,
        processing: 'reused',
        message: `Your download link is on its way to ${email}.`,
        fileCount: photos.length,
        requestId,
      });
    }

    await enqueueJob({ eventId, email, photos, requestId });

    const videoCount = photos.filter((p) => p.mediaType === 'video').length;

    console.log(
      `Queued archive for ${eventId} [${requestId}]: ${photos.length} files, ${totalSizeMB.toFixed(0)}MB`
    );

    return json(202, {
      success: true,
      processing: 'queued',
      message: `We're packaging ${photos.length} files. You'll get an email at ${email} when it's ready.`,
      fileCount: photos.length,
      estimatedSizeMB: Math.round(totalSizeMB),
      videoCount,
      // Honest rather than optimistic. Instance start is ~60-90s, then roughly
      // a minute per GB over the network.
      estimatedWaitTime: totalSizeMB > 2000 ? '10-20 minutes' : totalSizeMB > 500 ? '5-10 minutes' : '2-5 minutes',
      requestId,
    });
  } catch (error) {
    console.error(`Download request failed [${requestId}]:`, error);
    return json(500, {
      error: 'We could not start your download. Please try again in a moment.',
      requestId,
    });
  }
};
