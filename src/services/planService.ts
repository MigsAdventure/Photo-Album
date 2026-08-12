// Upload-window rules, client copy (finding UX-1).
//
// MIRROR OF netlify/functions/_lib/plan.js — keep the two in step.
//
// The server is authoritative: upload-init.js runs the same check and rejects
// anything it disagrees with, so a client that gets this wrong cannot upload
// something it should not. This copy exists so the UI can explain the state
// before a guest picks a file, rather than letting them choose photos and then
// fail. tests/plan-parity.test.js asserts the two implementations agree.
//
// Why a window instead of a count: the old rule was two photos per *event*, so
// the third guest at a wedding was blocked and shown an upgrade modal for an
// event they neither owned nor could pay for. Their photos were lost for good —
// nobody re-uploads after being told no.

import { Event } from '../types';

export const FREE_UPLOAD_WINDOW_HOURS = 72;
export const ABUSE_CEILING = 5000;

export type UploadReason = 'ok' | 'window_closed' | 'ceiling' | 'inactive';

export interface UploadState {
  canUpload: boolean;
  reason: UploadReason;
  isPremium: boolean;
  closesAt: Date | null;
  photoCount: number;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate();
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * When uploads close for a free event.
 *
 * Anchored to the event date rather than creation: planners set galleries up
 * weeks ahead, and a window measured from creation would be shut before the
 * first guest arrived.
 */
export function uploadWindowEnd(event: Pick<Event, 'date' | 'createdAt'>): Date {
  const created = toDate(event.createdAt) || new Date();

  // Dates are stored 'YYYY-MM-DD'. Anchor to the end of that day so an event
  // "on the 14th" stays open through the 14th, not until 00:00 on it.
  //
  // The Z is load-bearing — see the note in netlify/functions/_lib/plan.js.
  // Without it JavaScript parses this as LOCAL time, so the browser and the
  // Netlify function disagreed by up to 13 hours about when uploads close.
  const parsed = typeof event.date === 'string' ? new Date(`${event.date}T23:59:59Z`) : null;
  const anchor = parsed && !Number.isNaN(parsed.getTime()) && parsed > created ? parsed : created;

  return new Date(anchor.getTime() + FREE_UPLOAD_WINDOW_HOURS * 60 * 60 * 1000);
}

export function getUploadState(
  event: Pick<Event, 'date' | 'createdAt' | 'planType' | 'photoCount' | 'isActive'>,
  now: Date = new Date()
): UploadState {
  const photoCount = Number(event.photoCount ?? 0);
  const isPremium = event.planType === 'premium';

  if (event.isActive === false) {
    return { canUpload: false, reason: 'inactive', isPremium, closesAt: null, photoCount };
  }

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
 * do different things about it. Asking a guest to upgrade is the bug UX-1 is
 * about.
 */
export function explainUploadState(
  state: UploadState,
  audience: 'guest' | 'organizer' = 'guest'
): string | null {
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

/** Human-friendly countdown for the gallery header and the dashboard. */
export function describeTimeRemaining(closesAt: Date | null, now: Date = new Date()): string | null {
  if (!closesAt) return null;

  const ms = closesAt.getTime() - now.getTime();
  if (ms <= 0) return null;

  const hours = Math.floor(ms / (1000 * 60 * 60));

  if (hours >= 48) return `${Math.floor(hours / 24)} days left to add photos`;
  if (hours >= 2) return `${hours} hours left to add photos`;

  const minutes = Math.max(1, Math.floor(ms / (1000 * 60)));
  return `${minutes} minutes left to add photos`;
}
