// Thumbnail generation, in the browser, at upload time.
//
// The gallery had no thumbnail pipeline at all: the grid loaded every photo at
// full resolution (finding UX-3). A 400-photo wedding meant several hundred
// megabytes over cellular before anything was usable — at the reception, on the
// venue's wifi, which is exactly when people want to look.
//
// Generating here rather than server-side is a deliberate trade. It costs no
// infrastructure, adds no per-image fee, and the device has already decoded the
// image to show a preview. The cost is a second upload per file (~30 KB) and
// nothing for pre-existing photos, which keep serving originals until they are
// backfilled.
//
// Videos get a frame grab instead, which also gives the grid a still to show
// where it previously rendered a <video> element per tile.

const THUMBNAIL_MAX_EDGE = 480;
const THUMBNAIL_QUALITY = 0.72;

export interface Thumbnail {
  blob: Blob;
  contentType: string;
  /** Dimensions of the thumbnail itself. */
  width: number;
  height: number;
  /** Dimensions of the source media, kept separately so the two never blur. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Video only, in seconds. */
  duration?: number;
}

/** Fit within a square bound while preserving aspect ratio. */
function scaleToFit(width: number, height: number, maxEdge: number) {
  if (width <= maxEdge && height <= maxEdge) {
    return { width, height };
  }

  const ratio = width / height;
  return ratio >= 1
    ? { width: maxEdge, height: Math.round(maxEdge / ratio) }
    : { width: Math.round(maxEdge * ratio), height: maxEdge };
}

/**
 * WebP where supported, JPEG otherwise.
 *
 * Safari gained WebP encoding in 16.4; older iPhones are common at events, and
 * canvas.toBlob silently falls back to PNG for an unsupported type — which would
 * produce thumbnails several times larger than the JPEG we were avoiding.
 */
function pickThumbnailType(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL('image/webp').startsWith('data:image/webp')
    ? 'image/webp'
    : 'image/jpeg';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode thumbnail'))),
      type,
      quality
    );
  });
}

/** Decode an image file without holding the object URL open on failure. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image'));
    };

    img.src = url;
  });
}

export const generateImageThumbnail = async (file: File): Promise<Thumbnail> => {
  const img = await loadImage(file);
  const { width, height } = scaleToFit(img.naturalWidth, img.naturalHeight, THUMBNAIL_MAX_EDGE);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  // Meaningfully better downscaling on large camera photos, and supported
  // everywhere that matters.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const contentType = pickThumbnailType();
  const blob = await canvasToBlob(canvas, contentType, THUMBNAIL_QUALITY);

  return {
    blob,
    contentType,
    width,
    height,
    sourceWidth: img.naturalWidth,
    sourceHeight: img.naturalHeight,
  };
};

/**
 * Grab a frame from a video for use as a poster.
 *
 * Seeks a little way in rather than to 0 — the first frame of a phone video is
 * very often black or a blur while the sensor settles.
 */
export const generateVideoThumbnail = (file: File): Promise<Thumbnail> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };

    // Some codecs never fire loadeddata. Don't hang the upload queue waiting.
    const timer = setTimeout(() => fail('Timed out reading this video'), 15000);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 4);
    };

    video.onseeked = async () => {
      clearTimeout(timer);
      try {
        const { width, height } = scaleToFit(
          video.videoWidth,
          video.videoHeight,
          THUMBNAIL_MAX_EDGE
        );

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable');
        ctx.drawImage(video, 0, 0, width, height);

        const contentType = pickThumbnailType();
        const blob = await canvasToBlob(canvas, contentType, THUMBNAIL_QUALITY);

        const result: Thumbnail = {
          blob,
          contentType,
          width,
          height,
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
          duration: Number.isFinite(video.duration) ? video.duration : undefined,
        };

        cleanup();
        resolve(result);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    video.onerror = () => {
      clearTimeout(timer);
      fail('Could not read this video');
    };

    video.src = url;
  });
};

/**
 * Best-effort thumbnail for any media file.
 *
 * Returns null rather than throwing: a missing thumbnail costs a slower grid
 * tile, while a thrown error would lose the upload. The photo always matters
 * more than its preview.
 */
export const generateThumbnail = async (file: File): Promise<Thumbnail | null> => {
  try {
    if (file.type.startsWith('video/')) {
      return await generateVideoThumbnail(file);
    }
    if (file.type.startsWith('image/')) {
      return await generateImageThumbnail(file);
    }
    return null;
  } catch (error) {
    console.warn('⚠️ Could not generate a thumbnail, continuing without one:', error);
    return null;
  }
};
