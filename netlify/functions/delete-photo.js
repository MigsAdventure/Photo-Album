/**
 * Delete a photo across all three stores it lives in.
 *
 * Before finding SEC-5/SEC-7, deletion ran entirely in the browser: the client
 * checked localStorage for ownership, deleted the Firestore document, attempted
 * the Storage object (which the storage rules denied outright), and never
 * touched R2. The photo vanished from the gallery while the bytes stayed in two
 * stores, billed indefinitely, and undeleteable through any UI. That is also
 * why the app cannot currently honour a "delete my photo" request from a guest.
 *
 * Security model — read this before changing the check below
 * ----------------------------------------------------------
 * The application has no user authentication, so the server cannot know who is
 * calling. What it can do is require the caller to present a secret that only
 * the uploader holds. Each browser generates a high-entropy session secret and
 * stores it in localStorage; the photo document records only its SHA-256 hash,
 * so the secret is never broadcast to other guests reading the gallery.
 *
 * The previous scheme stored the raw session id in the document, which every
 * client could read via subscribeToPhotos — so any guest could copy another
 * guest's id and delete their photos. Documents written under that scheme are
 * still accepted here (see LEGACY below) so existing events keep working, but
 * they carry that weakness until the photo ages out.
 *
 * This is deliberately best-effort. It restores the property the old client
 * check was pretending to have, and it makes deletion consistent across stores.
 * Robust authorisation needs real identity, which arrives with magic-link auth
 * in Phase 4 (finding UX-2). At that point this endpoint should additionally
 * allow the event organizer to delete anything in their own event.
 *
 * Refs: AUDIT_2026-08.md SEC-5, SEC-7
 */

const crypto = require('crypto');
const { getDb, getBucket, FieldValue, isConfigured } = require('./_lib/firebase-admin');
const r2 = require('./_lib/r2');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time comparison, so a caller cannot learn a valid token by measuring
 * how long the comparison takes.
 */
function safeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Does the presented secret prove ownership of this photo?
 *
 * Current scheme: the document holds sha256(secret).
 * LEGACY scheme:  the document holds the raw session id. Accepted for photos
 *                 uploaded before this change; remove once those have aged out.
 */
function ownsPhoto(photoData, ownerSecret) {
  const recorded = photoData.uploadedBy;
  if (!recorded || !ownerSecret) return false;

  if (safeEquals(recorded, sha256Hex(ownerSecret))) return true;
  if (safeEquals(recorded, ownerSecret)) return true; // LEGACY

  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!isConfigured()) {
    console.error('delete-photo: FIREBASE_SERVICE_ACCOUNT is not set');
    return json(500, {
      error: 'Deletion is not available right now. Please try again later.',
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const { photoId, ownerSecret } = body;

  if (!photoId || typeof photoId !== 'string') {
    return json(400, { error: 'photoId is required' });
  }
  if (!ownerSecret || typeof ownerSecret !== 'string') {
    return json(400, { error: 'ownerSecret is required' });
  }

  const db = getDb();
  const photoRef = db.collection('photos').doc(photoId);

  try {
    const snapshot = await photoRef.get();

    if (!snapshot.exists) {
      // Already gone. Report success so a retry after a partial failure — or a
      // double-tap in the UI — settles cleanly instead of showing an error.
      return json(200, { success: true, alreadyDeleted: true });
    }

    const photo = snapshot.data();

    if (!ownsPhoto(photo, ownerSecret)) {
      console.warn(`delete-photo: ownership check failed for ${photoId}`);
      return json(403, { error: 'You can only delete photos that you uploaded' });
    }

    const results = { firestore: false, storage: false, r2: false };

    // Storage and R2 first. If either throws we stop before removing the
    // Firestore document, so the photo is still listed and the delete can be
    // retried. The reverse order is what produced the orphans in SEC-7.
    if (photo.storagePath) {
      try {
        await getBucket().file(photo.storagePath).delete();
        results.storage = true;
      } catch (error) {
        if (error.code === 404) {
          results.storage = 'not found';
        } else {
          throw error;
        }
      }
    }

    if (photo.r2Key && r2.isConfigured()) {
      const outcome = await r2.deleteObject(photo.r2Key);
      results.r2 = outcome.deleted ? true : outcome.reason;
    }

    await photoRef.delete();
    results.firestore = true;

    // The count is advisory; a failure here must not fail the delete, or the
    // caller retries and we attempt to delete an object that is already gone.
    if (photo.eventId) {
      try {
        await db
          .collection('events')
          .doc(photo.eventId)
          .update({ photoCount: FieldValue.increment(-1) });
      } catch (error) {
        console.warn(
          `delete-photo: could not decrement photoCount for ${photo.eventId}:`,
          error.message
        );
      }
    }

    console.log(`delete-photo: removed ${photoId}`, results);
    return json(200, { success: true, results });
  } catch (error) {
    console.error(`delete-photo: failed for ${photoId}:`, error);
    return json(500, {
      error: 'Could not delete the photo. Please try again.',
    });
  }
};
