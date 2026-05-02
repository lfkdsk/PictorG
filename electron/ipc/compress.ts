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

  // .rotate() with no args reads EXIF orientation, applies it, and resets
  // orientation to 1 in the output. Doing this before withMetadata() makes
  // sure the saved orientation tag matches the actual pixel layout
  // (otherwise viewers double-rotate).
  pipeline = pipeline.rotate();

  if (request.preserveExif) {
    // withMetadata copies EXIF (camera, GPS, timestamp, etc.) onto the
    // output. Combined with the .rotate() above this is the equivalent of
    // squoosh + manual exif-library reinsertion the web flow does.
    pipeline = pipeline.withMetadata();
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
