// Sharp-backed image compression in the main process. Replaces the
// renderer-side squoosh worker for desktop, which (a) tripped over
// Next 14's webpack handling of nested workers and (b) silently fell
// through to "no compression" when squoosh's dynamic imports failed
// inside the worker context.
//
// Sharp wraps libvips and emits its own EXIF on output. In practice the
// fields it copies are a subset of the originals (some camera-specific
// makernotes, GPS sub-IFDs, etc. drop out depending on the libvips
// build). The web path doesn't have this problem because it does the
// load→strip-orientation→dump→insert dance against the original bytes,
// which is byte-for-byte exact apart from the orientation tag we
// deliberately drop. We mirror that flow here so desktop and web
// produce equivalent metadata.

import { ipcMain } from 'electron';
import sharp from 'sharp';
// @lfkdsk/exif-library is CJS and ships type definitions for these
// symbols; the top-level `insert` auto-detects JPEG/WebP/PNG by header.
import { dump, insert, load, TagNumbers } from '@lfkdsk/exif-library';

import { CHANNELS } from './contract';
import type { CompressImageRequest, CompressImageResult } from './contract';

function basenameWithoutExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

// Mirror src/lib/compress-image.ts: pull EXIF off the original bytes,
// drop the Orientation tag (sharp.rotate() already baked it into pixels,
// keeping the tag would make viewers double-rotate), then re-inject the
// segment into the freshly-encoded output. Returns the original output
// unchanged if the input has no EXIF segment we can read.
function supplementExif(
  inputBuffer: Buffer,
  outputBuffer: Buffer
): Buffer {
  // exif-library works in binary strings (one char = one byte). Buffer's
  // 'binary' / 'latin1' encoding does that conversion both ways without
  // any bit munging.
  const inputStr = inputBuffer.toString('binary');
  let exif: any;
  try {
    exif = load(inputStr);
  } catch {
    return outputBuffer;
  }
  if (!exif || typeof exif !== 'object') return outputBuffer;
  // Empty IFDs would dump to a near-empty segment — pointless to inject.
  const hasAny =
    Object.keys(exif['0th'] ?? {}).length > 0 ||
    Object.keys(exif['Exif'] ?? {}).length > 0 ||
    Object.keys(exif['GPS'] ?? {}).length > 0 ||
    Object.keys(exif['1st'] ?? {}).length > 0 ||
    Object.keys(exif['Interop'] ?? {}).length > 0;
  if (!hasAny) return outputBuffer;

  if (exif['0th'] && TagNumbers.ImageIFD.Orientation in exif['0th']) {
    delete exif['0th'][TagNumbers.ImageIFD.Orientation];
  }

  let exifBytes: string;
  try {
    exifBytes = dump(exif);
  } catch {
    return outputBuffer;
  }

  const outputStr = outputBuffer.toString('binary');
  let merged: string;
  try {
    merged = insert(exifBytes, outputStr);
  } catch {
    return outputBuffer;
  }
  return Buffer.from(merged, 'binary');
}

async function compressImage(
  request: CompressImageRequest
): Promise<CompressImageResult> {
  const input = Buffer.from(request.bytes);

  // failOn: 'none' lets sharp keep going on minor codec warnings (slightly
  // truncated JPEG markers etc) — the input here came from a user picker,
  // not adversarial bytes, so loosening this is fine.
  let pipeline = sharp(input, { failOn: 'none' });

  // Diagnostic: log whether the source actually has EXIF before we touch it.
  const inMeta = await sharp(input, { failOn: 'none' }).metadata();
  console.log('[picg compress] input', {
    format: inMeta.format,
    hasExif: !!inMeta.exif,
    exifBytes: inMeta.exif?.length ?? 0,
    hasXmp: !!inMeta.xmp,
    orientation: inMeta.orientation,
  });

  // .rotate() with no args reads EXIF orientation, applies it, and resets
  // orientation to 1 in the output. Doing this here means the supplement
  // step can safely drop the Orientation tag without leaving a mismatch.
  pipeline = pipeline.rotate();

  let outBuffer: Buffer;
  let extension: string;
  let mimeType: string;

  if (request.outputFormat === 'jpeg') {
    outBuffer = await pipeline.jpeg({ mozjpeg: true, quality: 75 }).toBuffer();
    extension = '.jpg';
    mimeType = 'image/jpeg';
  } else {
    outBuffer = await pipeline.webp({ quality: 75 }).toBuffer();
    extension = '.webp';
    mimeType = 'image/webp';
  }

  if (request.preserveExif) {
    outBuffer = supplementExif(input, outBuffer);
  }

  // Diagnostic: confirm metadata round-tripped to the output.
  try {
    const outMeta = await sharp(outBuffer).metadata();
    console.log('[picg compress] output', {
      format: outMeta.format,
      bytes: outBuffer.length,
      hasExif: !!outMeta.exif,
      exifBytes: outMeta.exif?.length ?? 0,
      hasXmp: !!outMeta.xmp,
      orientation: outMeta.orientation,
    });
  } catch {
    /* probing the output is best-effort; ignore failures */
  }

  return {
    buffer: new Uint8Array(outBuffer.buffer, outBuffer.byteOffset, outBuffer.byteLength),
    name: `${basenameWithoutExt(request.originalName)}${extension}`,
    type: mimeType,
  };
}

export function registerCompressIpcHandlers(): void {
  ipcMain.handle(
    CHANNELS.compress.image,
    async (_e, request: CompressImageRequest) => {
      return compressImage(request);
    }
  );
}
