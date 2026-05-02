/// <reference lib="webworker" />

// Runs compressImage off the main thread. squoosh's encoders already run in
// their own workers, but the EXIF library (@lfkdsk/exif-library) and the
// FileReader.readAsBinaryString step are synchronous and operate on multi-MB
// binary strings — that's what was freezing UI between photos.
//
// Pattern: dedicated worker, request/response keyed by id. The renderer side
// (useCompressWorker) wraps it in a simple per-call Promise.

import { compressImage } from '@/lib/compress-image';

export type CompressRequest = {
  id: string;
  file: File;
};

export type CompressResponse =
  | { id: string; ok: true; file: File }
  | { id: string; ok: false; error: string };

self.addEventListener('message', async (event: MessageEvent<CompressRequest>) => {
  const { id, file } = event.data;
  try {
    const result = await compressImage(file);
    const response: CompressResponse = { id, ok: true, file: result };
    (self as unknown as Worker).postMessage(response);
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
