// Sharp-backed image compression in the main process. Replaces the
// renderer-side squoosh worker for desktop, which (a) tripped over
// Next 14's webpack handling of nested workers and (b) silently fell
// through to "no compression" when squoosh's dynamic imports failed
// inside the worker context.
//
// Sharp wraps libvips, which natively preserves EXIF and auto-rotates
// based on EXIF orientation — so we don't need the manual EXIF
// load/dump/insert dance that compress-image.ts (the web path) does.

import { ipcMain } from 'electron';
import sharp from 'sharp';

import { CHANNELS } from './contract';
import type { CompressImageRequest, CompressImageResult } from './contract';

function basenameWithoutExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
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
  // Some pipelines / cameras store metadata only in XMP, in which case
  // .keepMetadata() won't have an EXIF segment to copy.
  const inMeta = await sharp(input, { failOn: 'none' }).metadata();
  console.log('[picg compress] input', {
    format: inMeta.format,
    hasExif: !!inMeta.exif,
    exifBytes: inMeta.exif?.length ?? 0,
    hasXmp: !!inMeta.xmp,
    orientation: inMeta.orientation,
  });

  // .rotate() with no args reads EXIF orientation, applies it, and resets
  // orientation to 1 in the output. Doing this before keepMetadata() makes
  // sure the saved orientation tag matches the actual pixel layout
  // (otherwise viewers double-rotate).
  pipeline = pipeline.rotate();

  if (request.preserveExif) {
    // .keepMetadata() is the post-0.32 sharp API for "copy all metadata
    // (EXIF + ICC + XMP) from input to output". The older .withMetadata()
    // alias still exists but its behaviour around modern metadata chunks
    // is inconsistent across libvips versions.
    pipeline = pipeline.keepMetadata();
  }

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
