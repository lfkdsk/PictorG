import yaml from 'js-yaml';

import type { StorageAdapter } from '@/core/storage';

// Photo extensions we'll scan for rescue. Includes HEIC even though
// the album page's IMAGE_EXTS list doesn't — HEIC is exactly the
// "huge source file" we want to compress, and the deployed gallery
// already pairs HEIC with its `.webp` thumbnail.
export const RESCUE_IMAGE_EXTS = [
  '.jpg', '.jpeg', '.png', '.heic', '.heif',
  '.webp', '.avif', '.bmp', '.gif',
];

// MOV (Live Photo partner) is intentionally not rescued — sharp can't
// re-encode video and the existing compress pipeline passes it through.

export type OversizedPhoto = {
  albumUrl: string;     // directory name from README.yml's `url:`
  albumName: string;    // YAML key (display name)
  fileName: string;     // basename, e.g., "IMG_1234.heic"
  path: string;         // repo-root-relative, e.g., "Cat/IMG_1234.heic"
  size: number;
  ext: string;          // lowercase, includes leading dot
};

type AlbumEntry = {
  url: string;
  cover?: string;
};

function parseAlbumsForRescue(yamlText: string): Array<{ name: string; url: string }> {
  const data = yaml.load(yamlText, { schema: yaml.CORE_SCHEMA, json: true }) as
    | Record<string, AlbumEntry>
    | null;
  if (!data || typeof data !== 'object') return [];
  const out: Array<{ name: string; url: string }> = [];
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

export type ScanProgress = { albumIndex: number; albumCount: number; albumName: string };

export async function scanOversizedPhotos(
  adapter: StorageAdapter,
  thresholdBytes: number,
  onProgress?: (p: ScanProgress) => void,
): Promise<OversizedPhoto[]> {
  const readme = await adapter.readFile('README.yml');
  const albums = parseAlbumsForRescue(readme.text());

  const results: OversizedPhoto[] = [];
  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    onProgress?.({ albumIndex: i, albumCount: albums.length, albumName: album.name });
    let entries;
    try {
      entries = await adapter.listDirectory(album.url);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.type !== 'file') continue;
      const ext = lowerExt(e.name);
      if (!RESCUE_IMAGE_EXTS.includes(ext)) continue;
      if (typeof e.size !== 'number' || e.size < thresholdBytes) continue;
      results.push({
        albumUrl: album.url,
        albumName: album.name,
        fileName: e.name,
        path: `${album.url}/${e.name}`,
        size: e.size,
        ext,
      });
    }
  }
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
