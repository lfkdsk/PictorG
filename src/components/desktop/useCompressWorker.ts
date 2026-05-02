'use client';

import { useCallback, useEffect, useRef } from 'react';

import { compressImage } from '@/lib/compress-image';
import type { CompressResponse } from './compressWorker';

// Hook that lazily spins up the compression worker, exposes a Promise-shaped
// `compress(file)`, and tears the worker down on unmount. Calls are
// multiplexed onto a single worker and demultiplexed by request id —
// instantiating one worker per page keeps WASM load amortized across all
// photos in a single create-album session.
//
// If the worker can't start (Next dev chunk drift, sandbox quirks, etc.)
// or it dies mid-batch, every subsequent call falls back to running
// compressImage on the main thread. That brings back the UI freeze the
// worker was meant to avoid, but it's strictly better than silently
// returning uncompressed files — which is what the previous version did
// when squoosh's internal dynamic imports failed inside the worker.
//
// The returned `compress` is stable across renders (ref-backed) so callers
// can put it in useEffect deps without triggering re-runs.
export function useCompressWorker(): {
  compress: (file: File) => Promise<File>;
} {
  const workerRef = useRef<Worker | null>(null);
  const workerDeadRef = useRef(false);
  const pendingRef = useRef<
    Map<string, { resolve: (f: File) => void; reject: (e: Error) => void }>
  >(new Map());

  useEffect(() => {
    // Capture the Map reference now so the cleanup uses the same instance
    // regardless of any later reassignment (we never reassign, but eslint
    // is right that capturing is the safer pattern).
    const pending = pendingRef.current;
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      for (const entry of pending.values()) {
        entry.reject(new Error('Compression worker terminated'));
      }
      pending.clear();
    };
  }, []);

  function killWorker(reason: string) {
    workerDeadRef.current = true;
    workerRef.current?.terminate();
    workerRef.current = null;
    for (const entry of pendingRef.current.values()) {
      entry.reject(new Error(reason));
    }
    pendingRef.current.clear();
  }

  const compress = useCallback(async (file: File): Promise<File> => {
    // Once the worker has died (or never started) every subsequent call
    // runs on the main thread. UI will hitch per photo but at least the
    // bytes get compressed.
    if (workerDeadRef.current) {
      return compressImage(file);
    }

    let worker = workerRef.current;
    if (!worker) {
      try {
        worker = new Worker(new URL('./compressWorker.ts', import.meta.url), {
          type: 'module',
        });
        worker.addEventListener('message', (e: MessageEvent<CompressResponse>) => {
          const entry = pendingRef.current.get(e.data.id);
          if (!entry) return;
          pendingRef.current.delete(e.data.id);
          if (e.data.ok) {
            // Reconstitute the File on the receiving side. Worker sent the
            // bytes as a transferable buffer to avoid structured-clone
            // dropping the underlying Blob (which manifested as a 0-byte
            // compressed file in earlier builds).
            const reconstituted = new File([e.data.buffer], e.data.name, {
              type: e.data.type,
            });
            entry.resolve(reconstituted);
          } else {
            entry.reject(new Error(e.data.error));
          }
        });
        worker.addEventListener('error', (e) => {
          console.warn('[picg] compress worker fatal error', e.message ?? e);
          killWorker('compression worker died');
        });
        worker.addEventListener('messageerror', () => {
          console.warn('[picg] compress worker messageerror');
          killWorker('compression worker postMessage failure');
        });
        workerRef.current = worker;
      } catch (err) {
        console.warn(
          '[picg] could not start compress worker; falling back to main thread',
          err
        );
        workerDeadRef.current = true;
        return compressImage(file);
      }
    }

    const id = crypto.randomUUID();
    try {
      return await new Promise<File>((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        worker!.postMessage({ id, file });
      });
    } catch (err) {
      // Worker died (handler above) or the message round-trip threw. Retry
      // on the main thread once before giving up to the caller.
      if (workerDeadRef.current) {
        return compressImage(file);
      }
      throw err;
    }
  }, []);

  return { compress };
}
