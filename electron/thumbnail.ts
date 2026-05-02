// On-disk thumbnail cache for the picg://gallery/... protocol handler.
//
// Why: the gallery overview page renders ~85 album cover thumbnails as
// 260px-wide cards. Without resizing, the browser downloads + decodes
// 85 × multi-MB original webps at once — UI stalls, memory spikes,
// some images never finish loading on weaker GPUs. Web flow avoids
// this by reading from a CDN that pre-resized the images at build
// time. Desktop has no CDN; we resize locally and cache the result
// the first time each (path, width) combo is requested.
//
// Cache layout: <userData>/thumb-cache/<sha1(absPath|width|mtime)>.webp
// The mtime in the key invalidates the cache when the source file
// changes, so a photo replacement is picked up automatically without
// a manual purge. Stale entries linger but are cheap (~30-80 KB
// each); a follow-up could add LRU eviction once the cache grows
// large enough to matter.

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

let cacheDirPromise: Promise<string> | null = null;

async function ensureCacheDir(): Promise<string> {
  if (!cacheDirPromise) {
    cacheDirPromise = (async () => {
      const dir = path.join(app.getPath('userData'), 'thumb-cache');
      await fs.mkdir(dir, { recursive: true });
      return dir;
    })();
  }
  return cacheDirPromise;
}

function cacheKey(absPath: string, width: number, mtimeMs: number): string {
  return createHash('sha1')
    .update(`${absPath}|${width}|${mtimeMs}`)
    .digest('hex');
}

// Returns a webp buffer scaled to fit within `width` pixels (preserving
// aspect ratio, no enlargement). Reads from cache when possible; otherwise
// runs sharp once and writes the result for the next call.
export async function getOrCreateThumbnail(
  absPath: string,
  width: number
): Promise<Buffer> {
  // Stat first so we can include the source mtime in the cache key.
  const stat = await fs.stat(absPath);
  const dir = await ensureCacheDir();
  const cachePath = path.join(
    dir,
    `${cacheKey(absPath, width, stat.mtimeMs)}.webp`
  );

  try {
    return await fs.readFile(cachePath);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  // Miss — resize and write.
  // - withoutEnlargement: don't upscale tiny images
  // - rotate(): apply EXIF orientation so the thumbnail isn't sideways
  // - quality 78 is a good balance for cards at this size; visible
  //   compression artifacts only show up below ~70.
  const buf = await sharp(absPath, { failOn: 'none' })
    .rotate()
    .resize(width, null, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  // Write best-effort — a failed write doesn't fail the request.
  fs.writeFile(cachePath, buf).catch(() => {
    /* concurrent thumbnail requests for the same key may race here;
       last writer wins, both buffers are identical. */
  });

  return buf;
}

// Clamp the renderer-supplied width to a sane range. An attacker who
// could inject a giant value (or `?thumb=NaN`) would otherwise OOM the
// main process or exhaust disk via the cache.
export function parseThumbWidth(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const w = Math.round(n);
  if (w < 64 || w > 2048) return null;
  return w;
}
