// Upload media straight from the browser to Cloudflare R2.
//
// Replaces the two-step Firebase-then-copy path (finding ZIP-10). Previously a
// file went to Firebase Storage, and a Netlify function pulled the whole thing
// into memory to copy it to R2. Anything approaching a gigabyte blew both the
// memory limit and the execution window, so large videos never reached R2 —
// leaving them served from Firebase at $0.12/GB egress, fetched from Firebase by
// the archive worker, and stored (and paid for) twice.
//
// The browser now writes to R2 itself using short-lived presigned URLs. The
// server chooses the key and the size ceiling, and confirms the object exists
// before recording it, so a presigned URL is never a blank cheque.
//
// Refs: AUDIT_2026-08.md ZIP-10, UX-3

import { getOwnerToken } from './sessionService';
import { generateThumbnail } from './thumbnailService';

export interface UploadResult {
  photoId: string;
  url: string;
  size: number;
  mediaType: 'photo' | 'video';
}

interface UploadTarget {
  mode: 'single' | 'multipart';
  r2Key: string;
  uploadUrl?: string;
  uploadId?: string;
  partSize?: number;
  partUrls?: string[];
  uploadToken: string;
  maxBytes: number;
}

/** Thrown when the event has hit its plan limit, so the UI can offer an upgrade. */
export class PlanLimitError extends Error {
  photoCount: number;
  photoLimit: number;

  constructor(message: string, photoCount: number, photoLimit: number) {
    super(message);
    this.name = 'PlanLimitError';
    this.photoCount = photoCount;
    this.photoLimit = photoLimit;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let payload: any = {};
    try {
      payload = await response.json();
    } catch {
      /* non-JSON error body */
    }

    if (response.status === 402 && payload?.reason === 'plan_limit') {
      throw new PlanLimitError(
        payload.error || 'This event has reached its upload limit.',
        payload.photoCount ?? 0,
        payload.photoLimit ?? 0
      );
    }

    throw new Error(payload?.error || `Upload failed (${response.status})`);
  }

  return response.json();
}

/**
 * PUT a blob with progress.
 *
 * XMLHttpRequest rather than fetch: fetch still has no upload progress event in
 * any shipping browser, and a guest pushing a 400 MB video over hotel wifi with
 * no feedback assumes the app has frozen and kills it.
 */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ eTag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Needed to complete a multipart upload. R2 exposes it via CORS only if
        // the bucket's ExposeHeaders includes ETag — see docs/runbooks.
        resolve({ eTag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new Error(`Storage rejected the upload (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));

    xhr.send(body);
  });
}

/** Retry a part a few times — one flaky part should not lose a whole video. */
async function putPartWithRetry(
  url: string,
  chunk: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
  attempts = 3
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { eTag } = await putWithProgress(url, chunk, contentType, (loaded) =>
        onProgress(loaded)
      );

      if (!eTag) {
        throw new Error(
          'Storage did not return an ETag. The R2 bucket CORS policy must expose the ETag header.'
        );
      }

      return eTag;
    } catch (error) {
      lastError = error as Error;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError ?? new Error('Part upload failed');
}

/** Upload the thumbnail. Never fatal — a missing preview beats a lost photo. */
async function uploadThumbnail(
  eventId: string,
  thumb: { blob: Blob; contentType: string }
): Promise<string | null> {
  try {
    const target = await postJson<UploadTarget>('/.netlify/functions/upload-init', {
      eventId,
      fileName: 'thumb.webp',
      contentType: thumb.contentType,
      size: thumb.blob.size,
    });

    if (target.mode !== 'single' || !target.uploadUrl) return null;

    await putWithProgress(target.uploadUrl, thumb.blob, thumb.contentType);
    return target.r2Key;
  } catch (error) {
    console.warn('⚠️ Thumbnail upload failed, continuing without one:', error);
    return null;
  }
}

/**
 * Upload one file and record it.
 *
 * Progress is reported across the whole operation, weighted so the bar tracks
 * the bytes rather than the steps — thumbnail and finalisation are near-instant
 * and should not each consume a visible chunk of the bar.
 */
export const uploadMediaToR2 = async (
  file: File,
  eventId: string,
  onProgress?: (percent: number) => void
): Promise<UploadResult> => {
  const contentType = file.type || 'application/octet-stream';
  onProgress?.(1);

  // Do this first: it is the step most likely to fail on an odd codec, and
  // failing before we have written any bytes keeps the bucket clean.
  const thumb = await generateThumbnail(file);
  onProgress?.(4);

  const target = await postJson<UploadTarget>('/.netlify/functions/upload-init', {
    eventId,
    fileName: file.name,
    contentType,
    size: file.size,
  });

  onProgress?.(5);

  // 5% start, 90% for the bytes, 5% to finalise.
  const reportBytes = (uploaded: number) => {
    onProgress?.(5 + Math.min(90, (uploaded / file.size) * 90));
  };

  let parts: Array<{ partNumber: number; eTag: string }> | undefined;

  if (target.mode === 'single') {
    if (!target.uploadUrl) throw new Error('Upload target was incomplete');
    await putWithProgress(target.uploadUrl, file, contentType, (loaded) => reportBytes(loaded));
  } else {
    const partSize = target.partSize ?? 16 * 1024 * 1024;
    const urls = target.partUrls ?? [];
    parts = [];

    // Sequential, not parallel. Parallel parts finish sooner on a good
    // connection, but on the congested wifi these uploads actually happen over
    // they compete for the same bandwidth and time out together — and the whole
    // reason for multipart here is resilience, not speed.
    let confirmedBytes = 0;

    for (let i = 0; i < urls.length; i++) {
      const start = i * partSize;
      const chunk = file.slice(start, Math.min(start + partSize, file.size));

      const eTag = await putPartWithRetry(urls[i], chunk, contentType, (loaded) =>
        reportBytes(confirmedBytes + loaded)
      );

      confirmedBytes += chunk.size;
      reportBytes(confirmedBytes);
      parts.push({ partNumber: i + 1, eTag });
    }
  }

  onProgress?.(95);

  const thumbnailKey = thumb ? await uploadThumbnail(eventId, thumb) : null;

  const result = await postJson<UploadResult>('/.netlify/functions/upload-complete', {
    eventId,
    r2Key: target.r2Key,
    uploadId: target.uploadId,
    parts,
    uploadToken: target.uploadToken,
    maxBytes: target.maxBytes,
    contentType,
    fileName: file.name,
    ownerToken: await getOwnerToken(),
    thumbnailKey,
    width: thumb?.sourceWidth,
    height: thumb?.sourceHeight,
    duration: thumb?.duration,
  });

  onProgress?.(100);
  return result;
};
