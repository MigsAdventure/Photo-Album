/**
 * Issue presigned R2 upload targets so the browser writes straight to storage.
 *
 * What this replaces (finding ZIP-10)
 * -----------------------------------
 * Uploads went to Firebase Storage, then r2-copy.js pulled the whole file into a
 * Netlify function's memory with `await response.buffer()` and wrote it to R2.
 * Photos were fine. A 1.5 GB video — which videoService.ts explicitly permits —
 * exceeded both the memory limit and the execution window, so those files never
 * reached R2 at all. The consequences compounded:
 *
 *   - the gallery served them from Firebase at $0.12/GB egress
 *   - the archive job fetched them from Firebase too, which is the slow origin
 *     that made the ZIP-3 queueing bug bite hardest
 *   - every byte was stored twice and paid for twice
 *
 * Going direct removes the copy, the double storage, and the size ceiling in one
 * step. Firebase Storage leaves the write path entirely; Firestore stays as the
 * metadata store.
 *
 * Security model
 * --------------
 * A presigned URL is a capability: whoever holds it can write that exact key.
 * So the server, not the client, decides the key, the content type and the size
 * ceiling — a client that could name its own key could overwrite another event's
 * photos, or write outside the media prefix entirely.
 *
 * The response carries an `uploadToken`, an HMAC over the fields the completion
 * step must be able to trust. Without it, a caller could upload a 20 KB file and
 * then tell upload-complete it was a 2 GB video attached to somebody else's
 * event.
 *
 * Refs: AUDIT_2026-08.md ZIP-10, UX-3
 */

const crypto = require('crypto');
const { randomUUID } = require('crypto');
const {
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getClient, getBucketName, isConfigured: r2Configured } = require('./_lib/r2');
const { getDb, isConfigured: firebaseConfigured } = require('./_lib/firebase-admin');
const { getUploadState, explainUploadState } = require('./_lib/plan');

// Above this, use multipart. R2 accepts a single PUT well beyond this, but a
// failed 500 MB PUT restarts from zero — on hotel wifi at a wedding reception
// that is the difference between an upload landing and a guest giving up.
const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
const PART_SIZE = 16 * 1024 * 1024;

// Matches firestore.rules and storage.rules. Keep the three in step.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

// Presigned URLs are short-lived by design. Long enough for a slow phone to push
// a part, short enough that a leaked URL is not a standing write capability.
const URL_TTL_SECONDS = 60 * 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/**
 * Sign the facts that upload-complete has to be able to trust.
 * Shared with upload-complete.js — change one, change both.
 */
function signUpload(payload) {
  const secret = process.env.UPLOAD_TOKEN_SECRET || process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) throw new Error('UPLOAD_TOKEN_SECRET is not configured');

  return crypto
    .createHmac('sha256', secret)
    .update(
      [payload.eventId, payload.r2Key, payload.maxBytes, payload.contentType].join('\n'),
      'utf8'
    )
    .digest('hex');
}

function extensionFor(fileName, contentType) {
  const fromName = String(fileName || '').split('.').pop();
  if (fromName && /^[a-zA-Z0-9]{1,5}$/.test(fromName)) return fromName.toLowerCase();

  const fromType = String(contentType || '').split('/').pop();
  return /^[a-zA-Z0-9]{1,5}$/.test(fromType) ? fromType.toLowerCase() : 'bin';
}

function isAllowedContentType(contentType) {
  return /^(image|video)\//.test(String(contentType || ''));
}

// The browser leaves `file.type` empty for .HEIC and for some Android pickers,
// and the client sends 'application/octet-stream' when it does. The client's own
// validation (src/services/mediaUploadService.ts) falls back to the extension and
// accepts the file, so a server that judged only by MIME type rejected uploads
// the app had already told the guest were fine — a 400 for a perfectly good photo.
const EXTENSION_CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  wmv: 'video/x-ms-wmv',
};

/**
 * Decide what this upload actually is.
 *
 * Returns a content type guaranteed to be image/* or video/*, or null when the
 * file is neither. A declared media type wins; the extension is the fallback.
 *
 * We deliberately never pass an arbitrary client string through. Whatever is
 * returned here is signed into the presigned URL and is what R2 stores and later
 * serves from the public bucket host, so honouring a declared 'text/html' on a
 * file named .jpg would be a stored-XSS vector on our own domain.
 */
function resolveContentType(contentType, fileName) {
  if (isAllowedContentType(contentType)) return String(contentType);

  const ext = String(fileName || '').toLowerCase().split('.').pop();
  return EXTENSION_CONTENT_TYPES[ext] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!r2Configured() || !firebaseConfigured()) {
    console.error('upload-init: R2 or Firebase is not configured');
    return json(503, { error: 'Uploads are unavailable right now. Please try again shortly.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const { eventId, fileName, contentType, size } = body;

  if (!eventId || typeof eventId !== 'string') {
    return json(400, { error: 'eventId is required' });
  }
  const resolvedContentType = resolveContentType(contentType, fileName);
  if (!resolvedContentType) {
    return json(400, { error: 'Only photos and videos can be uploaded' });
  }

  const byteSize = Number(size);
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return json(400, { error: 'A valid file size is required' });
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    return json(413, {
      error: `That file is ${(byteSize / 1024 / 1024 / 1024).toFixed(1)} GB. The limit is 2 GB.`,
    });
  }

  try {
    const db = getDb();
    const eventDoc = await db.collection('events').doc(eventId).get();

    if (!eventDoc.exists) {
      return json(404, { error: 'That event could not be found' });
    }

    const eventData = eventDoc.data();
    if (eventData.isActive === false) {
      return json(403, { error: 'This event is no longer accepting uploads' });
    }

    // This is the authoritative check. The client runs the same logic
    // (src/services/planService.ts) so it can explain the state before a guest
    // picks a file, but nothing depends on the client being right.
    //
    // Note the status code: 403, not 402. A closed upload window is a fact about
    // the event, not a payment demand — the guest hitting it is usually not the
    // person who could pay, and telling them otherwise is finding UX-1.
    const uploadState = getUploadState(eventData);

    if (!uploadState.canUpload) {
      return json(403, {
        error: explainUploadState(uploadState, 'guest'),
        reason: uploadState.reason,
        closesAt: uploadState.closesAt ? uploadState.closesAt.toISOString() : null,
        photoCount: uploadState.photoCount,
      });
    }

    const client = getClient();
    const Bucket = getBucketName();
    const r2Key = `media/${eventId}/${randomUUID()}.${extensionFor(fileName, resolvedContentType)}`;

    // A little headroom over the declared size: browsers occasionally re-encode
    // during transfer, and a hard equality here would reject legitimate uploads.
    const maxBytes = Math.min(Math.ceil(byteSize * 1.05) + 1024, MAX_UPLOAD_BYTES);
    const uploadToken = signUpload({ eventId, r2Key, maxBytes, contentType: resolvedContentType });

    if (byteSize <= MULTIPART_THRESHOLD) {
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: r2Key, ContentType: resolvedContentType }),
        { expiresIn: URL_TTL_SECONDS }
      );

      // contentType comes back because ContentType is a *signed* header on the
      // presigned URL. If we resolved it to something other than what the client
      // declared, the client has to PUT with the resolved value or R2 rejects the
      // request as a signature mismatch — and upload-complete recomputes the same
      // HMAC, so it has to send the resolved value there too.
      return json(200, {
        mode: 'single',
        r2Key,
        uploadUrl,
        uploadToken,
        maxBytes,
        contentType: resolvedContentType,
      });
    }

    const created = await client.send(
      new CreateMultipartUploadCommand({ Bucket, Key: r2Key, ContentType: resolvedContentType })
    );

    const partCount = Math.ceil(byteSize / PART_SIZE);

    // R2 caps a multipart upload at 10,000 parts. At 16 MB each that is 160 GB,
    // far above our 2 GB ceiling, so this is a guard against a bad size rather
    // than a real limit.
    if (partCount > 10000) {
      return json(413, { error: 'That file is too large to upload' });
    }

    const partUrls = await Promise.all(
      Array.from({ length: partCount }, (_, i) =>
        getSignedUrl(
          client,
          new UploadPartCommand({
            Bucket,
            Key: r2Key,
            UploadId: created.UploadId,
            PartNumber: i + 1,
          }),
          { expiresIn: URL_TTL_SECONDS }
        )
      )
    );

    return json(200, {
      mode: 'multipart',
      r2Key,
      uploadId: created.UploadId,
      partSize: PART_SIZE,
      partUrls,
      uploadToken,
      maxBytes,
      contentType: resolvedContentType,
    });
  } catch (error) {
    console.error('upload-init failed:', error);
    return json(500, { error: 'Could not start the upload. Please try again.' });
  }
};

module.exports.signUpload = signUpload;
module.exports.resolveContentType = resolveContentType;
module.exports.MULTIPART_THRESHOLD = MULTIPART_THRESHOLD;
module.exports.PART_SIZE = PART_SIZE;
