'use client';

// Generate a small blob URL for an in-memory File, used by the photo
// upload grids in new-album and [album]/add. Without this they were
// rendering each picked image at its native resolution — a 50 MP
// JPEG sitting in a 200 px square card forced the browser to decode
// + composite the full bitmap, blowing GPU memory and slowing the
// drop-twenty-files-at-once flow to a crawl.
//
// Approach: createImageBitmap with resizeWidth/Height + medium
// quality. Chromium decodes off-thread, downsamples once, hands us
// back a small bitmap. We draw it onto an OffscreenCanvas and
// convertToBlob('image/webp', 0.7) for a tiny output (~30–80 KB
// regardless of source size).
//
// HEIC bypass: createImageBitmap doesn't decode HEIC in Chromium.
// On failure we fall back to URL.createObjectURL(file) so the user
// at least sees something for those files (the browser will fail
// rendering, but the placeholder cell is the same as before this
// optimization). Long-term fix is to route HEIC through the main
// process for sips→jpeg→thumbnail; left as follow-up.

const PREVIEW_MAX_EDGE = 480;
const PREVIEW_QUALITY = 0.7;

export async function makePreviewUrl(file: File): Promise<string> {
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap');
    const bmp = await createImageBitmap(file, {
      resizeWidth: PREVIEW_MAX_EDGE,
      resizeHeight: PREVIEW_MAX_EDGE,
      resizeQuality: 'medium',
    });

    // OffscreenCanvas may not be available in older renderer surfaces;
    // fall back to a regular canvas in that case.
    let blob: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bmp, 0, 0);
      blob = await canvas.convertToBlob({
        type: 'image/webp',
        quality: PREVIEW_QUALITY,
      });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bmp, 0, 0);
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob null'))),
          'image/webp',
          PREVIEW_QUALITY
        )
      );
    }
    bmp.close?.();
    return URL.createObjectURL(blob);
  } catch {
    // HEIC, broken file, no createImageBitmap support — fall back to
    // the original. The browser may still fail to render (HEIC), but
    // the upload pipeline still works.
    return URL.createObjectURL(file);
  }
}
