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
//
// Video handling: a Live Photo's `.MOV` rides along with its still and gets
// its own card in the grid, but neither createImageBitmap nor sips can
// decode video — the card used to end up pointed at raw QuickTime bytes,
// which renders as a broken image. Those files get a frame grab off a
// detached <video> instead (same decoder the timeline uses to hover-play
// Live Photos), and an empty string when even that fails so callers can
// draw a placeholder.

const PREVIEW_MAX_EDGE = 480;
const PREVIEW_QUALITY = 0.7;
// Longer edge for the main-process (sips) HEIC render. This preview also
// serves as the compare modal's full-size "Original" image, where the
// 480px grid thumbnail would look soft.
const MAIN_PREVIEW_MAX_EDGE = 1024;

const HEIC_EXT = /\.(heic|heif)$/i;
const HEIC_TYPE = /^image\/(heic|heif)$/i;
const VIDEO_EXT = /\.(mov|mp4|m4v)$/i;
const VIDEO_TYPE = /^video\//i;

// Where to grab the poster frame from. Frame zero of a Live Photo is often
// still stabilising (the shutter fires ~1.5s into the 3s clip), so a hair in
// looks better while staying instant to seek to.
const POSTER_SEEK_SECONDS = 0.1;
const POSTER_TIMEOUT_MS = 8000;

// True for files Chromium can't decode for display (HEIC/HEIF). Callers use
// this to prefer the generated `preview` over a raw object URL of the
// original when picking what to show in the compare modal.
export function isHeic(file: File): boolean {
  return HEIC_TYPE.test(file.type) || HEIC_EXT.test(file.name);
}

// True for the Live Photo `.MOV` half (and any other video the picker let
// through). These are uploaded verbatim — no compress, no compare — so the
// grids use this to skip the before/after affordances too.
export function isVideoFile(file: File): boolean {
  return VIDEO_TYPE.test(file.type) || VIDEO_EXT.test(file.name);
}

// Filename minus its extension, lowercased: the key that pairs a Live
// Photo's `IMG_1234.MOV` with the `IMG_1234.HEIC` it belongs to.
export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

export async function makePreviewUrl(file: File): Promise<string> {
  // Video: nothing here decodes it, so grab a frame instead. Empty string
  // when the codec isn't available (a Windows renderer without HEVC, say) —
  // the grids draw a video placeholder rather than a broken <img>.
  if (isVideoFile(file)) return (await makeVideoPosterUrl(file)) ?? '';

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

    try {
      return await encodeToWebpUrl(bmp, bmp.width, bmp.height);
    } finally {
      bmp.close?.();
    }
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

// Draw a decoded source (an ImageBitmap, or the current frame of a <video>)
// into a canvas at the given size and hand back an object URL for the WebP.
// OffscreenCanvas may not be available in older renderer surfaces; fall back
// to a regular canvas in that case.
async function encodeToWebpUrl(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<string> {
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(source, 0, 0, width, height);
    blob = await canvas.convertToBlob({
      type: 'image/webp',
      quality: PREVIEW_QUALITY,
    });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(source, 0, 0, width, height);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob null'))),
        'image/webp',
        PREVIEW_QUALITY
      )
    );
  }
  return URL.createObjectURL(blob);
}

// Pull a poster frame out of a video File. Chromium plays QuickTime H.264
// and — on macOS — HEVC, which covers what iPhones write for Live Photos;
// the timeline already leans on the same decoder to hover-play them.
// Returns null when the file won't decode or won't seek in time, and the
// caller falls back to a placeholder.
async function makeVideoPosterUrl(file: File): Promise<string | null> {
  const src = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('video preview timed out')),
        POSTER_TIMEOUT_MS
      );
      const settle = (fail?: string) => {
        clearTimeout(timer);
        if (fail) reject(new Error(fail));
        else resolve();
      };
      video.onerror = () => settle('video decode failed');
      video.onseeked = () => settle();
      video.onloadeddata = () => {
        // Seek past the opening frame when the clip is long enough to have
        // one to spare; otherwise the frame already decoded will do.
        const target = Math.min(POSTER_SEEK_SECONDS, (video.duration || 0) / 2);
        if (target > 0 && video.seekable.length > 0) {
          video.currentTime = target;
          return; // resolved by onseeked
        }
        settle();
      };
      video.src = src;
    });

    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) throw new Error('video has no frame');
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(w, h));
    return await encodeToWebpUrl(video, Math.round(w * scale), Math.round(h * scale));
  } catch {
    return null;
  } finally {
    // Drop the decoder and the last reference to the blob before revoking.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(src);
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
