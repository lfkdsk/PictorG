'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { CompressResponse } from './compressWorker';

// Hook that lazily spins up the compression worker, exposes a Promise-shaped
// `compress(file)`, and tears the worker down on unmount. Calls are
// multiplexed onto a single worker and demultiplexed by request id —
// instantiating one worker per page keeps WASM load amortized across all
// photos in a single create-album session.
//
// The returned `compress` is stable across renders (ref-backed) so callers
// can put it in useEffect deps without triggering re-runs.
export function useCompressWorker(): {
  compress: (file: File) => Promise<File>;
} {
  const workerRef = useRef<Worker | null>(null);
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

  const compress = useCallback((file: File): Promise<File> => {
    let worker = workerRef.current;
    if (!worker) {
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
          const file = new File([e.data.buffer], e.data.name, { type: e.data.type });
          entry.resolve(file);
        } else {
          entry.reject(new Error(e.data.error));
        }
      });
      workerRef.current = worker;
    }
    const id = crypto.randomUUID();
    return new Promise<File>((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject });
      worker!.postMessage({ id, file });
    });
  }, []);

  return { compress };
}
