// Offloads the synchronous, CPU-heavy hdrify gain-map encode (readExr →
// encodeGainMap → writeJpegGainMap) off the Electron MAIN event loop into a
// worker thread, so a batch of HEIC→HDR-JPEG imports doesn't stall window
// controls. hdrify is pure-JS and synchronous (~1-3s/image); on the main loop
// it serializes encodes and lags other IPC/window ops.
//
// The worker is an INLINE (eval) script — no separate file to compile, bundle,
// path-resolve, or asar-unpack — and loads hdrify (ESM) via a Function-wrapped
// dynamic import, the same trick the main process uses. Main resolves hdrify's
// absolute path (require.resolve works because main's own import works) and
// passes it in, so the worker doesn't depend on bare-specifier resolution from
// its own context. A single persistent worker processes requests serially
// (hdrify is sync), which is enough to free main's loop. compress.ts falls back
// to a main-thread encode if the worker can't start — slower, never broken.

import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const importESM = new Function('s', 'return import(s)');
let hdrifyPromise = null;
parentPort.on('message', async (msg) => {
  const { id, exrPath, quality, exif, hdrifyUrl } = msg;
  try {
    if (!hdrifyPromise) hdrifyPromise = importESM(hdrifyUrl);
    const hdrify = await hdrifyPromise;
    const exr = fs.readFileSync(exrPath);
    const img = hdrify.readExr(new Uint8Array(exr.buffer, exr.byteOffset, exr.byteLength));
    const encoded = hdrify.encodeGainMap(img, { toneMapping: 'reinhard' });
    const jpeg = hdrify.writeJpegGainMap(encoded, {
      quality,
      format: 'ultrahdr',
      ...(exif ? { exif } : {}),
    });
    const ab = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength);
    parentPort.postMessage({ id, ok: true, jpeg: ab }, [ab]);
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
});
`;

type Pending = { resolve: (b: Uint8Array) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Pending>();
let hdrifyUrl: string | null = null;

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    const w = new Worker(WORKER_SOURCE, { eval: true });
    w.unref(); // don't keep the process alive at quit
    w.on(
      'message',
      (msg: { id: number; ok: boolean; jpeg?: ArrayBuffer; error?: string }) => {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok && msg.jpeg) p.resolve(new Uint8Array(msg.jpeg));
        else p.reject(new Error(msg.error ?? 'hdrify worker error'));
      }
    );
    w.on('error', (err) => {
      // Catastrophic failure (e.g. couldn't load hdrify in this packaging):
      // disable the worker for the session so callers fall back to main.
      workerBroken = true;
      worker = null;
      failAll(err);
    });
    w.on('exit', () => {
      worker = null;
      failAll(new Error('hdrify worker exited'));
    });
    worker = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

// Encode an Ultra HDR JPEG from a linear EXR file in the worker thread. The
// worker reads the EXR off disk itself (the path, not the bytes, crosses the
// thread boundary), and the resulting JPEG ArrayBuffer is transferred back
// zero-copy. Rejects if the worker is unavailable so the caller can fall back.
export function encodeUltraHdrInWorker(
  exrPath: string,
  quality: number,
  exif: Uint8Array | null
): Promise<Uint8Array> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('hdrify worker unavailable'));
  if (!hdrifyUrl) hdrifyUrl = pathToFileURL(require.resolve('hdrify')).href;
  const id = ++seq;
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, exrPath, quality, exif, hdrifyUrl });
  });
}
