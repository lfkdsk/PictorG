import yaml from 'js-yaml';

import type { StorageAdapter } from '@/core/storage';

// Photo extensions we'll scan for shrink. Includes HEIC even though
// the album page's IMAGE_EXTS list doesn't — HEIC is exactly the
// "huge source file" we want to compress, and the deployed gallery
// already pairs HEIC with its `.webp` thumbnail.
export const SHRINK_IMAGE_EXTS = [
  '.jpg', '.jpeg', '.png', '.heic', '.heif',
  '.webp', '.avif', '.bmp', '.gif',
];

// MOV (Live Photo partner) is intentionally not shrunk — sharp can't
// re-encode video and the existing compress pipeline passes it through.

export type OversizedPhoto = {
  albumUrl: string;     // directory name from README.yml's `url:`
  albumName: string;    // YAML key (display name)
  fileName: string;     // basename, e.g., "IMG_1234.heic"
  path: string;         // repo-root-relative, e.g., "Cat/IMG_1234.heic"
  size: number;
  ext: string;          // lowercase, includes leading dot
};

export type AlbumRef = { name: string; url: string };

type AlbumEntry = {
  url: string;
  cover?: string;
};

function parseAlbumsForShrink(yamlText: string): AlbumRef[] {
  const data = yaml.load(yamlText, { schema: yaml.CORE_SCHEMA, json: true }) as
    | Record<string, AlbumEntry>
    | null;
  if (!data || typeof data !== 'object') return [];
  const out: AlbumRef[] = [];
  for (const [name, fields] of Object.entries(data)) {
    if (!fields || typeof fields !== 'object') continue;
    if (typeof fields.url !== 'string' || !fields.url) continue;
    out.push({ name: name.trim(), url: fields.url });
  }
  return out;
}

function lowerExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx).toLowerCase();
}

// Per-album lifecycle events. The page listens for these to drive a
// live tree of "queued / scanning / done / error" rows; multiple
// albums can sit in 'scanning' simultaneously thanks to the worker-pool
// concurrency below.
export type ScanEvent =
  | { type: 'init'; albums: AlbumRef[] }
  | { type: 'albumStart'; url: string }
  | { type: 'albumDone'; url: string; total: number; oversized: number }
  | { type: 'albumError'; url: string; error: string };

// Cap on simultaneous listDirectory IPC roundtrips. listDirectory in
// LocalGitStorageAdapter is just fs.readdir + a stat per entry, so we
// can run several in parallel without saturating either Node's libuv
// thread pool or the Electron IPC bus. 6 keeps the visual "many albums
// scanning at once" feel for galleries with 6+ albums while staying
// well below libuv's default 4-thread fs pool times any reasonable burst.
const SCAN_CONCURRENCY = 6;

export async function scanOversizedPhotos(
  adapter: StorageAdapter,
  thresholdBytes: number,
  onEvent?: (e: ScanEvent) => void,
): Promise<OversizedPhoto[]> {
  const readme = await adapter.readFile('README.yml');
  const albums = parseAlbumsForShrink(readme.text());
  onEvent?.({ type: 'init', albums });

  const results: OversizedPhoto[] = [];
  const queue = [...albums];

  async function processOne(album: AlbumRef) {
    onEvent?.({ type: 'albumStart', url: album.url });
    let entries;
    try {
      entries = await adapter.listDirectory(album.url);
    } catch (err) {
      onEvent?.({
        type: 'albumError',
        url: album.url,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    let total = 0;
    let oversized = 0;
    for (const e of entries) {
      if (e.type !== 'file') continue;
      const ext = lowerExt(e.name);
      if (!SHRINK_IMAGE_EXTS.includes(ext)) continue;
      total++;
      if (typeof e.size !== 'number' || e.size < thresholdBytes) continue;
      oversized++;
      results.push({
        albumUrl: album.url,
        albumName: album.name,
        fileName: e.name,
        path: `${album.url}/${e.name}`,
        size: e.size,
        ext,
      });
    }
    onEvent?.({ type: 'albumDone', url: album.url, total, oversized });
  }

  // Worker-pool: spawn N workers that each pull from the shared queue.
  // Albums beyond SCAN_CONCURRENCY wait their turn rather than all
  // firing listDirectory at once.
  const workers = Array.from(
    { length: Math.min(SCAN_CONCURRENCY, albums.length) },
    async () => {
      while (queue.length > 0) {
        const album = queue.shift();
        if (!album) return;
        await processOne(album);
      }
    },
  );
  await Promise.all(workers);

  results.sort((a, b) => b.size - a.size);
  return results;
}

// Predicts the on-disk path after compression with the given output
// format. The compress IPC always emits .webp or .jpg (per
// electron/ipc/compress.ts:227-272), so any input whose extension
// doesn't match the output format will be renamed.
export function predictedOutputPath(path: string, outputFormat: 'webp' | 'jpeg'): string {
  const targetExt = outputFormat === 'jpeg' ? '.jpg' : '.webp';
  return path.replace(/\.[^./]+$/, targetExt);
}

export function extensionWillChange(path: string, outputFormat: 'webp' | 'jpeg'): boolean {
  return predictedOutputPath(path, outputFormat).toLowerCase() !== path.toLowerCase();
}

// Rewrites `cover: <oldPath>` lines in a root README.yml to point at
// new paths. Uses regex line replacement instead of yaml.dump round-trip
// to keep the diff minimal — only the cover lines that actually moved
// will change, indentation/comments/ordering elsewhere stays intact.
export function rewriteCoverPaths(
  yamlText: string,
  mapping: Map<string, string>,
): { text: string; rewrites: Array<{ from: string; to: string }> } {
  let text = yamlText;
  const rewrites: Array<{ from: string; to: string }> = [];
  for (const [from, to] of mapping) {
    if (from === to) continue;
    const escaped = from.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Match cover: "Cat/15.heic"  | cover: 'Cat/15.heic' | cover: Cat/15.heic
    const re = new RegExp(
      `^(\\s*cover\\s*:\\s*)(['"]?)${escaped}\\2(\\s*(?:#.*)?)$`,
      'gm',
    );
    let matched = false;
    text = text.replace(re, (_m, prefix, quote, suffix) => {
      matched = true;
      return `${prefix}${quote}${to}${quote}${suffix}`;
    });
    if (matched) rewrites.push({ from, to });
  }
  return { text, rewrites };
}

export function findCoverReferences(yamlText: string): Set<string> {
  const data = yaml.load(yamlText, { schema: yaml.CORE_SCHEMA, json: true }) as
    | Record<string, AlbumEntry>
    | null;
  const out = new Set<string>();
  if (!data || typeof data !== 'object') return out;
  for (const fields of Object.values(data)) {
    if (fields && typeof fields === 'object' && typeof fields.cover === 'string') {
      out.add(fields.cover);
    }
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
