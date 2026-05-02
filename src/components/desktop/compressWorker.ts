/// <reference lib="webworker" />

// Runs compressImage off the main thread. squoosh's encoders already run in
// their own workers, but the EXIF library (@lfkdsk/exif-library) and the
// FileReader.readAsBinaryString step are synchronous and operate on multi-MB
// binary strings — that's what was freezing UI between photos.
//
// Pattern: dedicated worker, request/response keyed by id. We send back the
// compressed bytes as a transferable ArrayBuffer + filename/type, and let
// the renderer reconstruct the File. Sending the File object directly went
// through structured clone, which intermittently dropped its underlying
// Blob data in Electron renderers (resulting in file.size === 0 and an
// empty buffer landing in the eventual git commit).

import { compressImage } from '@/lib/compress-image';

export type CompressRequest = {
  id: string;
  file: File;
};

export type CompressResponse =
  | {
      id: string;
      ok: true;
      buffer: ArrayBuffer;
      name: string;
      type: string;
    }
  | { id: string; ok: false; error: string };

self.addEventListener('message', async (event: MessageEvent<CompressRequest>) => {
  const { id, file } = event.data;
  try {
    const result = await compressImage(file);
    const buffer = await result.arrayBuffer();
    const response: CompressResponse = {
      id,
      ok: true,
      buffer,
      name: result.name,
      type: result.type,
    };
    // Transfer the buffer (zero-copy) — keeps it as a real ArrayBuffer on
    // the receiving side and side-steps the structured-clone size-loss.
    (self as unknown as Worker).postMessage(response, [buffer]);
  } catch (err) {
    const response: CompressResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
});

export {};
