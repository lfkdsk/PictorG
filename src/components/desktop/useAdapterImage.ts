'use client';

import { useEffect, useRef, useState } from 'react';

import type { StorageAdapter } from '@/core/storage';

// Process-wide cache keyed by adapter id + path. Surviving across mounts is
// what makes thumbnail grids feel snappy when you bounce back from a
// lightbox; a tab reload still drops everything.
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function mimeForPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

async function loadDataUrl(
  adapter: StorageAdapter,
  path: string
): Promise<string> {
  const key = `${adapter.id}:${path}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const file = await adapter.readFile(path);
    const dataUrl = `data:${mimeForPath(path)};base64,${file.base64()}`;
    cache.set(key, dataUrl);
    inflight.delete(key);
    return dataUrl;
  })();
  inflight.set(key, promise);
  return promise;
}

// Reads `path` through the given adapter and exposes it as a data URL the
// renderer can drop into <img src=...>. Cached process-wide so flipping
// between thumbnail grid and lightbox doesn't re-decode.
//
// Returns `{ src, error }`. While loading, `src` is null.
export function useAdapterImage(
  adapter: StorageAdapter | null,
  path: string | null
): { src: string | null; error: string | null } {
  const [src, setSrc] = useState<string | null>(() => {
    if (!adapter || !path) return null;
    return cache.get(`${adapter.id}:${path}`) ?? null;
  });
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!adapter || !path) {
      setSrc(null);
      setError(null);
      return;
    }
    const cached = cache.get(`${adapter.id}:${path}`);
    if (cached) {
      setSrc(cached);
      setError(null);
      return;
    }

    const myReq = ++reqId.current;
    setSrc(null);
    setError(null);

    loadDataUrl(adapter, path)
      .then((url) => {
        if (reqId.current === myReq) setSrc(url);
      })
      .catch((err) => {
        if (reqId.current === myReq) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [adapter, path]);

  return { src, error };
}
