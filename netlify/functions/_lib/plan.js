/**
 * When can an event accept uploads? (finding UX-1)
 *
 * The old rule was two photos per *event*, on the free plan. Not per guest — per
 * event. So the third person to arrive at a wedding was blocked and shown an
 * upgrade modal for an event they did not own and could not pay for. From their
 * side the app was simply broken, and the organizer never found out. Every photo
 * that guest would have contributed was lost, permanently, because nobody
 * re-uploads after being told no.
 *
 * It was also the wrong shape commercially. Two photos is not a trial: nobody
 * experiences the product, so there is nothing to convert. The value of a shared
 * gallery only becomes visible once it fills up.
 *
 * The model now is a time window rather than a count. A free event accepts
 * everything guests can throw at it, from creation until 72 hours after the
 * event date — which covers the event, the night after, and the morning people
 * wake up and remember to upload. Then the gallery goes view-only: nothing is
 * deleted, nothing is hidden, and downloads keep working. Upgrading reopens it
 * permanently.
 *
 * That inverts who gets interrupted. A guest is never asked to pay; they see an
 * upload window that has closed, which is a fact about the event rather than a
 * sales pitch. The organizer is the one who gets the upgrade prompt, because
 * they are the one who can act on it.
 *
 * There is still a hard ceiling, but it is abuse protection rather than a
 * product limit — high enough that no real event reaches it.
 *
 * ---------------------------------------------------------------------------
 * This file is mirrored by src/services/planService.ts. The server is
 * authoritative (upload-init.js enforces it); the client copy exists so the UI
 * can explain the state before a guest picks a file. If you change the rules
 * here, change them there — there is a test asserting the two agree.
 * ---------------------------------------------------------------------------
 */

const FREE_UPLOAD_WINDOW_HOURS = 72;

// Not a plan limit. A single event producing more than this is either abuse or a
// bug, and either way we want to stop before the storage bill does.
const ABUSE_CEILING = 5000;

/**
 * When uploads close for a free event.
 *
 * Anchored to the event date, not the creation date: planners routinely set a
 * gallery up weeks ahead, and a window measured from creation would be shut
 * before the first guest arrives. If the date is missing or unparseable we fall
 * back to creation time, which is wrong-but-safe — the organizer can see the
 * closing time in the dashboard and fix the date.
 */
function uploadWindowEnd(event) {
  const created = toDate(event.createdAt) || new Date();

  // Event dates are stored as 'YYYY-MM-DD'. Anchor to the end of that day so an
  // event "on the 14th" stays open through the 14th, not until 00:00 on it.
  //
  // The Z is load-bearing. Without a zone suffix, JavaScript parses a datetime
  // string as LOCAL time — so this file computed one answer in the browser (the
  // guest's timezone) and a different one in a Netlify function (UTC), up to 13
  // hours apart. The UI would invite an upload the server then refused, or hide
  // one it would have accepted, and which happened depended on where the guest
  // was standing.
  //
  // The parity test could not catch this: both copies run in the same process
  // under the same TZ, so they agreed there and disagreed only in production.
  // Pinning both to UTC makes the answer independent of where it is computed.
  const parsed = typeof event.date === 'string' ? new Date(`${event.date}T23:59:59Z`) : null;
  const anchor = parsed && !Number.isNaN(parsed.getTime()) && parsed > created ? parsed : created;

  return new Date(anchor.getTime() + FREE_UPLOAD_WINDOW_HOURS * 60 * 60 * 1000);
}

/** Firestore Timestamp, Date, or ISO string — all turn up depending on the path. */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Can this event accept an upload right now?
 *
 * @returns {{
 *   canUpload: boolean,
 *   reason: 'ok'|'window_closed'|'ceiling'|'inactive',
 *   isPremium: boolean,
 *   closesAt: Date|null,
 *   photoCount: number
 * }}
 */
function getUploadState(event, now = new Date()) {
  const photoCount = Number(event.photoCount ?? 0);
  const isPremium = event.planType === 'premium';

  if (event.isActive === false) {
    return { canUpload: false, reason: 'inactive', isPremium, closesAt: null, photoCount };
  }

  // The ceiling applies to everyone. A premium event that has produced 5,000
  // files is not a customer we are serving well by continuing silently.
  if (photoCount >= ABUSE_CEILING) {
    return { canUpload: false, reason: 'ceiling', isPremium, closesAt: null, photoCount };
  }

  if (isPremium) {
    return { canUpload: true, reason: 'ok', isPremium: true, closesAt: null, photoCount };
  }

  const closesAt = uploadWindowEnd(event);

  return {
    canUpload: now < closesAt,
    reason: now < closesAt ? 'ok' : 'window_closed',
    isPremium: false,
    closesAt,
    photoCount,
  };
}

/**
 * What to tell the person in front of us.
 *
 * Guests and organizers get different copy for the same state, because they can
 * do different things about it. Asking a guest to upgrade is the bug this
 * finding is about.
 */
function explainUploadState(state, audience = 'guest') {
  switch (state.reason) {
    case 'ok':
      return null;

    case 'window_closed':
      return audience === 'organizer'
        ? 'Uploads have closed for this event. Upgrade to reopen them and keep the gallery open indefinitely.'
        : 'Uploads have closed for this event, but you can still browse and download everything here.';

    case 'ceiling':
      return audience === 'organizer'
        ? 'This event has reached the maximum number of files. Get in touch and we will raise it.'
        : 'This gallery is full, but you can still browse and download everything here.';

    case 'inactive':
      return 'This event has been closed by the organizer.';

    default:
      return 'Uploads are not available for this event right now.';
  }
}

module.exports = {
  FREE_UPLOAD_WINDOW_HOURS,
  ABUSE_CEILING,
  getUploadState,
  explainUploadState,
  uploadWindowEnd,
};
