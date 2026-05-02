'use client';

import { useEffect, useRef, useState } from 'react';

import { getPicgBridge, type StorageAdapter } from '@/core/storage';

// Process-wide cache keyed by adapter id + path. Surviving across mounts is
// what makes thumbnail grids feel snappy when you bounce back from a
// lightbox; a tab reload still drops everything.
//
// Note: this cache is only used by the data-URL path. When picgGalleryId is
// supplied we return picg:// URLs straight away — they're already pointing
// at on-disk files, so Chromium's HTTP cache + Electron's protocol handler
// do their own caching.
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function picgUrlFor(galleryId: string, p: string, thumbWidth?: number): string {
  const base = `picg://gallery/${encodeURIComponent(galleryId)}/${p
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  return thumbWidth ? `${base}?thumb=${thumbWidth}` : base;
}

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

// Reads `path` through the given adapter and exposes it as a URL the
// renderer can drop into <img src=...>.
//
// Two modes:
//   - With `options.picgGalleryId` set, return `picg://gallery/<id>/<path>`
//     synchronously. The Electron main process serves it from disk, so
//     no IPC + no base64 round-trip per thumbnail. This is what you want
//     for the desktop pages.
//   - Without it, fall back to the IPC + base64 + data-URL path. Used in
//     a non-Electron preview (rare) or anywhere the caller doesn't know
//     the gallery id.
//
// `options.thumbWidth` (only honored on the picg:// fast path) appends
// `?thumb=W` to the URL. The main process resizes + caches a webp at
// that width on first request and serves the cached version after.
// Use this for grids of small cards (album covers, the photo grid in
// an album page) — leave it off for full-resolution views like the
// lightbox where the original quality matters.
//
// Returns `{ src, error }`. While loading (data-URL path), `src` is null.
export function useAdapterImage(
  adapter: StorageAdapter | null,
  path: string | null,
  options?: { picgGalleryId?: string; thumbWidth?: number }
): { src: string | null; error: string | null } {
  const picgGalleryId = options?.picgGalleryId;
  const thumbWidth = options?.thumbWidth;
  const fastPath =
    picgGalleryId && path && getPicgBridge()
      ? picgUrlFor(picgGalleryId, path, thumbWidth)
      : null;

  const [src, setSrc] = useState<string | null>(() => {
    if (fastPath) return fastPath;
    if (!adapter || !path) return null;
    return cache.get(`${adapter.id}:${path}`) ?? null;
  });
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (fastPath) {
      setSrc(fastPath);
      setError(null);
      // Side-channel probe for picg:// URLs — main returns a JSON body
      // tagged with `X-Picg-Error` (or `X-Picg-Thumb-Error` for the
      // sharp-resize variant) for any non-200. Without this the <img>
      // tag would just paint a broken-image icon silently. We probe
      // every fast-path URL because the same failure modes (missing
      // file, permission error) hit the lightbox / cover picker too —
      // not just thumbnail URLs.
      const myReq = ++reqId.current;
      fetch(fastPath)
        .then(async (res) => {
          if (reqId.current !== myReq) return;
          if (res.ok) return;
          let detail = '';
          try {
            const data = await res.json();
            detail = data?.message
              ? `${data.error ?? 'error'}: ${data.message}`
              : data?.error ?? '';
          } catch {
            detail = await res.text().catch(() => '');
          }
          setError(detail || `picg:// ${res.status}`);
        })
        .catch(() => {
          /* protocol handler didn't respond at all — let the <img>
             onError surface that case */
        });
      return;
    }
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
  }, [adapter, path, fastPath]);

  return { src, error };
}
