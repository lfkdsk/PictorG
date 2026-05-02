'use client';

// Replacement for useCompressWorker. Sends compression work to the
// Electron main process (sharp / libvips) over IPC instead of running
// squoosh inside a renderer Web Worker. See:
//   docs/desktop-development.md (data layer scope, sharp rationale)
//   electron/ipc/compress.ts   (the main-side handler)
//
// Why: nested workers + Next 14's webpack handling of squoosh-browser
// produced chunk drift (404s) and silent compress-skip. Sharp lives in
// main, off the bundler entirely, and handles EXIF preservation +
// auto-rotation natively — no manual exif-library reinsertion needed.

import { useCallback } from 'react';

import { getPicgBridge } from '@/core/storage';
import { getCompressionSettings } from '@/lib/settings';

// HEIC slips into this list because the desktop main now transcodes it
// via macOS sips before sharp encode (see electron/ipc/compress.ts).
const COMPRESSIBLE_TYPES = /^image\/(png|jpe?g|webp|avif|tiff|gif|hei[cf])$/i;
const COMPRESSIBLE_EXTS = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|tiff?)$/i;

// MOV arrives alongside HEIC for Live Photos. We accept it in the
// upload UI but skip compression — sharp can't process video and we
// want the .mov to land in git unchanged so viewers can pair it back
// with the matching photo.
const PASSTHROUGH_EXTS = /\.mov$/i;
const PASSTHROUGH_TYPES = /^video\/quicktime$/i;

export function useCompressIpc(): {
  compress: (file: File) => Promise<File>;
} {
  const compress = useCallback(async (file: File): Promise<File> => {
    const bridge = getPicgBridge();
    const settings = getCompressionSettings();

    // Skip cases — return the original file untouched, same shape as the
    // squoosh path used to.
    if (!settings.enableWebP) return file;
    // Live-Photo MOV: keep alongside its HEIC partner without any
    // re-encode. Sharp doesn't process video, and we want the .mov to
    // land in git verbatim so a viewer can pair it back to the photo.
    if (
      PASSTHROUGH_TYPES.test(file.type) ||
      PASSTHROUGH_EXTS.test(file.name)
    ) {
      return file;
    }
    // Some browsers report image/heic as application/octet-stream or empty
    // type; fall back to filename extension when the MIME is unknown.
    const looksCompressible =
      COMPRESSIBLE_TYPES.test(file.type) || COMPRESSIBLE_EXTS.test(file.name);
    if (!looksCompressible) return file;

    if (!bridge) {
      // Running outside Electron (e.g. previewing the desktop pages in a
      // browser). Defer to the web compress path so this hook still
      // resolves with a valid File.
      const { compressImage } = await import('@/lib/compress-image');
      return compressImage(file);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await bridge.compress.image({
      bytes,
      originalName: file.name,
      outputFormat: settings.outputFormat,
      preserveExif: settings.preserveEXIF,
      lossless: settings.lossless,
    });
    return new File([result.buffer], result.name, { type: result.type });
  }, []);

  return { compress };
}
