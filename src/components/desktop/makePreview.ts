'use client';

import { getPicgBridge } from '@/core/storage';

// Generate a small blob URL for an in-memory File, used by the photo
// upload grids in new-album and [album]/add. Without this they were
// rendering each picked image at its native resolution — a 50 MP
// JPEG sitting in a 200 px square card forced the browser to decode
// + composite the full bitmap, blowing GPU memory and slowing the
// drop-twenty-files-at-once flow to a crawl.
//
// Approach: createImageBitmap with one resize edge + medium quality,
// so the browser computes the other edge from the source aspect ratio.
// Chromium decodes off-thread, downsamples, hands us back a small bitmap.
// We draw it onto an OffscreenCanvas and
// convertToBlob('image/webp', 0.7) for a tiny output (~30–80 KB
// regardless of source size).
//
// HEIC handling: createImageBitmap can't decode HEIC in Chromium. When it
// throws, and we're inside Electron, we route the file through the main
// process — which uses macOS `sips` to transcode it to a downscaled JPEG
// the renderer CAN show (see electron/ipc/compress.ts). That preview feeds
// both the grid card and the "Original" pane of the before/after compare
// modal. Outside Electron (web preview of the desktop pages) there's no
// bridge, so we fall back to URL.createObjectURL(file): the browser still
// won't render HEIC, but the upload pipeline keeps working.

const PREVIEW_MAX_EDGE = 480;
const PREVIEW_QUALITY = 0.7;
// Longer edge for the main-process (sips) HEIC render. This preview also
// serves as the compare modal's full-size "Original" image, where the
// 480px grid thumbnail would look soft.
const MAIN_PREVIEW_MAX_EDGE = 1024;

const HEIC_EXT = /\.(heic|heif)$/i;
const HEIC_TYPE = /^image\/(heic|heif)$/i;

// True for files Chromium can't decode for display (HEIC/HEIF). Callers use
// this to prefer the generated `preview` over a raw object URL of the
// original when picking what to show in the compare modal.
export function isHeic(file: File): boolean {
  return HEIC_TYPE.test(file.type) || HEIC_EXT.test(file.name);
}

export async function makePreviewUrl(file: File): Promise<string> {
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap');
    let bmp = await createImageBitmap(file, {
      resizeWidth: PREVIEW_MAX_EDGE,
      resizeQuality: 'medium',
    });

    if (bmp.height > PREVIEW_MAX_EDGE) {
      const oversized = bmp;
      try {
        bmp = await createImageBitmap(oversized, {
          resizeHeight: PREVIEW_MAX_EDGE,
          resizeQuality: 'medium',
        });
      } finally {
        oversized.close?.();
      }
    }

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
    // createImageBitmap couldn't decode this — overwhelmingly HEIC in
    // Chromium. In Electron, render a displayable JPEG in the main
    // process via sips so the grid + compare modal show real pixels.
    const viaMain = await makePreviewViaMain(file);
    if (viaMain) return viaMain;
    // No bridge (web) or sips failed: fall back to the raw original. The
    // browser may still fail to render HEIC, but the upload pipeline
    // still works and ImageOrPlaceholder degrades to a placeholder.
    return URL.createObjectURL(file);
  }
}

// Ask the Electron main process to transcode a browser-undecodable image
// (HEIC) into a small JPEG via sips. Returns an object URL, or null when
// there's no bridge (running in a plain browser) or the transcode fails —
// the caller then falls back to the raw file.
async function makePreviewViaMain(file: File): Promise<string | null> {
  try {
    const bridge = getPicgBridge();
    if (!bridge?.compress?.preview) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await bridge.compress.preview({
      bytes,
      originalName: file.name,
      maxEdge: MAIN_PREVIEW_MAX_EDGE,
    });
    const blob = new Blob([result.buffer], { type: result.type });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
