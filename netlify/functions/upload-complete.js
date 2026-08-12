/**
 * Finalise a direct-to-R2 upload and record it in Firestore.
 *
 * The browser writes the bytes to R2 itself using the presigned targets from
 * upload-init.js. This endpoint closes the loop: it completes the multipart
 * upload if there was one, verifies the object actually exists at the size we
 * authorised, and only then writes the photo document.
 *
 * Why the server writes the document
 * ----------------------------------
 * firestore.rules denies clients an r2Key at creation, because a client-supplied
 * key could point the gallery at any object in the bucket (finding SEC-2). Since
 * every upload now has an r2Key, document creation moves here entirely — which
 * also means the document cannot exist without the bytes existing, closing the
 * gap where a failed upload left a broken entry in the gallery.
 *
 * Verification, not trust
 * -----------------------
 * The uploadToken is an HMAC over the event, key, size ceiling and content type,
 * issued by upload-init. Without it a caller could upload a 20 KB file and then
 * claim it was a 2 GB video on someone else's event. The HeadObject check then
 * confirms the bytes are really there — a document is never written for an
 * upload that failed halfway.
 *
 * Refs: AUDIT_2026-08.md ZIP-10, SEC-2, UX-3
 */

const crypto = require('crypto');
const {
  HeadObjectCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const { getClient, getBucketName, isConfigured: r2Configured } = require('./_lib/r2');
const { getDb, FieldValue, isConfigured: firebaseConfigured } = require('./_lib/firebase-admin');
const { signUpload } = require('./upload-init');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function safeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Where the public can fetch this object. */
function publicUrlFor(r2Key) {
  const base = String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('R2_PUBLIC_URL is not configured');
  return `${base}/${r2Key}`;
}

function isVideo(contentType, fileName) {
  return (
    /^video\//.test(String(contentType || '')) ||
    /\.(mp4|mov|avi|webm|mkv|3gp|wmv)$/i.test(String(fileName || ''))
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!r2Configured() || !firebaseConfigured()) {
    return json(503, { error: 'Uploads are unavailable right now. Please try again shortly.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const {
    eventId,
    r2Key,
    uploadId,
    parts,
    uploadToken,
    maxBytes,
    contentType,
    fileName,
    ownerToken,
    thumbnailKey,
    width,
    height,
    duration,
  } = body;

  if (!eventId || !r2Key || !uploadToken || !contentType) {
    return json(400, { error: 'eventId, r2Key, contentType and uploadToken are required' });
  }

  // Recompute the signature from the values we were given. If any of them was
  // altered after upload-init issued the token, this will not match.
  let expected;
  try {
    expected = signUpload({ eventId, r2Key, maxBytes: Number(maxBytes), contentType });
  } catch (error) {
    console.error('upload-complete: cannot verify token —', error.message);
    return json(503, { error: 'Uploads are unavailable right now. Please try again shortly.' });
  }

  if (!safeEquals(uploadToken, expected)) {
    console.warn(`upload-complete: token mismatch for ${r2Key}`);
    return json(403, { error: 'This upload could not be verified' });
  }

  const client = getClient();
  const Bucket = getBucketName();

  try {
    if (uploadId) {
      if (!Array.isArray(parts) || parts.length === 0) {
        return json(400, { error: 'parts are required to complete a multipart upload' });
      }

      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: r2Key,
          UploadId: uploadId,
          MultipartUpload: {
            // R2 requires parts in ascending order; a browser uploading in
            // parallel will not necessarily report them that way.
            Parts: parts
              .map((p) => ({ PartNumber: Number(p.partNumber), ETag: p.eTag }))
              .sort((a, b) => a.PartNumber - b.PartNumber),
          },
        })
      );
    }

    // Confirm the bytes are actually there before writing anything to Firestore.
    const head = await client.send(new HeadObjectCommand({ Bucket, Key: r2Key }));
    const actualBytes = Number(head.ContentLength || 0);

    if (actualBytes <= 0) {
      return json(422, { error: 'The upload did not complete. Please try again.' });
    }

    if (Number.isFinite(Number(maxBytes)) && actualBytes > Number(maxBytes)) {
      // Larger than we authorised — refuse it and remove it rather than letting
      // an unbounded object sit in the bucket.
      console.warn(`upload-complete: ${r2Key} is ${actualBytes} bytes, over the authorised ${maxBytes}`);
      return json(413, { error: 'The uploaded file was larger than expected' });
    }

    // thumbnailKey is NOT covered by the upload token, because the thumbnail
    // gets its own upload-init call with its own token. Left unchecked it is an
    // arbitrary-object handle: whatever it names is written onto the photo
    // document, and delete-photo later deletes it. Chained with a deletion
    // primitive that is a way to remove any object in the bucket.
    //
    // Constrain it to this event's own media prefix — the same shape upload-init
    // generates — so the worst case is scoped to one event's own files.
    const safeThumbnailKey =
      typeof thumbnailKey === 'string' && thumbnailKey.startsWith(`media/${eventId}/`)
        ? thumbnailKey
        : null;

    if (thumbnailKey && !safeThumbnailKey) {
      console.warn(`upload-complete: rejected out-of-prefix thumbnailKey for ${eventId}`);
    }

    const db = getDb();
    const mediaType = isVideo(contentType, fileName) ? 'video' : 'photo';

    const docRef = await db.collection('photos').add({
      eventId,
      fileName: String(fileName || 'upload').slice(0, 500),
      contentType,
      size: actualBytes,
      mediaType,
      r2Key,
      url: publicUrlFor(r2Key),
      thumbnailUrl: safeThumbnailKey ? publicUrlFor(safeThumbnailKey) : null,
      thumbnailKey: safeThumbnailKey,
      width: Number.isFinite(Number(width)) ? Number(width) : null,
      height: Number.isFinite(Number(height)) ? Number(height) : null,
      duration: Number.isFinite(Number(duration)) ? Number(duration) : null,
      uploadedAt: FieldValue.serverTimestamp(),
      uploadedBy: String(ownerToken || '').slice(0, 100),
      storage: 'r2',
    });

    // Advisory counter for the plan limit. A failure here must not fail the
    // upload — the bytes and the document are already committed, and retrying
    // would double-count.
    try {
      await db.collection('events').doc(eventId).update({
        photoCount: FieldValue.increment(1),
      });
    } catch (error) {
      console.warn(`upload-complete: could not increment photoCount for ${eventId}:`, error.message);
    }

    console.log(`upload-complete: stored ${r2Key} (${actualBytes} bytes) as ${docRef.id}`);

    return json(200, {
      success: true,
      photoId: docRef.id,
      url: publicUrlFor(r2Key),
      size: actualBytes,
      mediaType,
    });
  } catch (error) {
    console.error(`upload-complete failed for ${r2Key}:`, error);

    // Don't leave an incomplete multipart upload accruing storage charges. R2
    // bills for uploaded parts until the upload is completed or aborted.
    if (uploadId) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({ Bucket, Key: r2Key, UploadId: uploadId })
        );
      } catch (abortError) {
        console.error(`upload-complete: could not abort ${uploadId}:`, abortError.message);
      }
    }

    return json(500, { error: 'Could not finish the upload. Please try again.' });
  }
};
