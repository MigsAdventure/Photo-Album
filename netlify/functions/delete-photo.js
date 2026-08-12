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
 * Guests are anonymous, so for them the server cannot know who is calling. What
 * it can do is require the caller to present a secret that only the uploader
 * holds. Each browser generates a high-entropy session secret and
 * stores it in localStorage; the photo document records only its SHA-256 hash,
 * so the secret is never broadcast to other guests reading the gallery.
 *
 * The previous scheme stored the raw session id in the document, which every
 * client could read via subscribeToPhotos — so any guest could copy another
 * guest's id and delete their photos. Documents written under that scheme are
 * still accepted here (see LEGACY below) so existing events keep working, but
 * they carry that weakness until the photo ages out.
 *
 * Since Phase 4 there is a second, stronger path: a signed-in organizer may
 * delete anything in their own event. That one is real authorisation — the
 * Firebase ID token is verified against Google's signing keys, so a caller
 * cannot simply assert an email address — and it is what makes moderation
 * possible. An organizer needs to be able to remove a photo a guest should not
 * have posted, and until now nobody could.
 *
 * Refs: AUDIT_2026-08.md SEC-5, SEC-7
 */

const crypto = require('crypto');
const { admin, getApp, getDb, getBucket, FieldValue, isConfigured } = require('./_lib/firebase-admin');
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
 * The document holds sha256(secret). The secret itself never leaves the
 * uploader's browser except in a call to this endpoint.
 *
 * REMOVED — a legacy branch that also accepted `recorded === ownerSecret`
 * -----------------------------------------------------------------------
 * It was there so photos uploaded before the hashing change stayed deletable by
 * their uploader. It was a complete bypass of the thing this function exists to
 * enforce.
 *
 * `uploadedBy` is returned to every client by subscribeToPhotos — the whole
 * reason we moved to storing a hash. So any gallery viewer could read another
 * guest's `uploadedBy` value and simply send it back as `ownerSecret`: the
 * legacy comparison matched it against itself and returned true. That is
 * precisely the cross-guest deletion hole SEC-5 was written to close,
 * reintroduced by the compatibility branch meant to soften the migration.
 *
 * The scheme it was preserving was never safe either — a plaintext session id in
 * a world-readable document is not a secret. So there is nothing to migrate
 * carefully: pre-hash photos are simply no longer deletable by their uploader.
 * The event organizer can still delete anything in their own event via the
 * verified-ID-token path below, which is the better answer anyway.
 */
function ownsPhoto(photoData, ownerSecret) {
  const recorded = photoData.uploadedBy;
  if (!recorded || !ownerSecret) return false;

  return safeEquals(recorded, sha256Hex(ownerSecret));
}

/**
 * Verify a Firebase ID token and confirm the holder organizes this event.
 *
 * verifyIdToken checks the signature against Google's rotating public keys and
 * the expiry, so this is a real identity check rather than a claim we are taking
 * on trust — which is what separates it from the uploader path above.
 *
 * Returns the organizer's email when authorised, or null.
 */
async function verifyOrganizer(idToken, eventId, db) {
  if (!idToken || !eventId) return null;

  try {
    const decoded = await admin.auth(getApp()).verifyIdToken(idToken);

    // An unverified email proves nothing. Email-link sign-in sets this, so a
    // legitimate organizer always has it.
    if (!decoded.email || decoded.email_verified !== true) {
      console.warn('delete-photo: token has no verified email');
      return null;
    }

    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) return null;

    const organizerEmail = String(eventDoc.data().organizerEmail || '').toLowerCase();
    if (!organizerEmail) return null;

    return decoded.email.toLowerCase() === organizerEmail ? organizerEmail : null;
  } catch (error) {
    // Expired or forged tokens land here. Not an error worth surfacing — the
    // caller simply is not authorised.
    console.warn('delete-photo: could not verify ID token:', error.message);
    return null;
  }
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

  const { photoId, ownerSecret, idToken } = body;

  if (!photoId || typeof photoId !== 'string') {
    return json(400, { error: 'photoId is required' });
  }
  if (!ownerSecret && !idToken) {
    return json(400, { error: 'ownerSecret or idToken is required' });
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

    // Two ways to be allowed. Uploader first because it needs no round trip.
    let authorised = ownsPhoto(photo, ownerSecret);
    let actor = 'uploader';

    if (!authorised && idToken) {
      const organizer = await verifyOrganizer(idToken, photo.eventId, db);
      if (organizer) {
        authorised = true;
        actor = `organizer:${organizer}`;
      }
    }

    if (!authorised) {
      console.warn(`delete-photo: authorisation failed for ${photoId}`);
      return json(403, {
        error: 'You can only delete photos you uploaded, or any photo in an event you organize',
      });
    }

    const results = { firestore: false, storage: false, r2: false, thumbnail: false };

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

    if (r2.isConfigured()) {
      if (photo.r2Key) {
        const outcome = await r2.deleteObject(photo.r2Key);
        results.r2 = outcome.deleted ? true : outcome.reason;
      }

      // The thumbnail is a second object (Phase 3, finding UX-3). Missing this
      // would recreate exactly the orphan problem SEC-7 was about — bytes left
      // in the bucket with no document referencing them, billed forever and
      // unreachable from any UI.
      if (photo.thumbnailKey) {
        const outcome = await r2.deleteObject(photo.thumbnailKey);
        results.thumbnail = outcome.deleted ? true : outcome.reason;
      }
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

    console.log(`delete-photo: removed ${photoId} by ${actor}`, results);
    return json(200, { success: true, results, deletedBy: actor });
  } catch (error) {
    console.error(`delete-photo: failed for ${photoId}:`, error);
    return json(500, {
      error: 'Could not delete the photo. Please try again.',
    });
  }
};
