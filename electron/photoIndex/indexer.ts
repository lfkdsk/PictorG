// Desktop-local photo index builder.
//
// Walks a cloned gallery the way album_template's build.py does — README.yml
// gives the album list, each album dir is listed for image files — and
// extracts EXIF per photo. The result is a set of plain, serializable rows
// the renderer turns into a real sqlite.db (same schema as the deployed
// build) so the timeline / annual-summary / stats pages read the *local*
// repo, picking up photos that haven't been pushed + CI-deployed yet.
//
// Incremental: every file's extracted EXIF is cached under
//   <userData>/photo-index/<galleryId>/exif-cache.json
// keyed by (mtimeMs, size). Re-runs only re-parse files that actually
// changed, so the first build of a large gallery is the only slow one.

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';

import { getRegistry } from '../ipc/gallery';
import { extractPhotoExif, type PhotoExif } from './exif';
import type {
  PhotoIndexData,
  PhotoIndexPhoto,
  PhotoIndexProgress,
  PhotoIndexResult,
} from '../../src/core/storage/electron/galleryTypes';

// Same set build.py effectively indexes (it skips .md/.yml/.mov + dotfiles).
// Allowlist is safer than a denylist here. HEIC is included; if exif-library
// can't parse it the photo still lands under "Unknown".
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff', '.heic', '.heif',
]);

const CACHE_VERSION = 1;

type CacheEntry = {
  mtimeMs: number;
  size: number;
  livephoto: boolean;
  exif: PhotoExif | null;
};
type CacheFile = {
  version: number;
  entries: Record<string, CacheEntry>;
};

export type ProgressFn = (p: PhotoIndexProgress) => void;

// Monotonic suffix for temp files so two concurrent atomic writes never
// collide on the temp name.
let tmpCounter = 0;

function indexRoot(): string {
  return path.join(app.getPath('userData'), 'photo-index');
}

function indexDir(galleryId: string): string {
  // galleryId reaches the saveDb path straight from the renderer; refuse any
  // value that would escape <userData>/photo-index (path separators, ".."),
  // mirroring the containment check the picg:// handler does in main.ts.
  const root = indexRoot();
  const dir = path.resolve(root, galleryId);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error(`Invalid galleryId: ${galleryId}`);
  }
  return dir;
}

// Write via a temp file + atomic rename so a crash or a second concurrent
// writer (Strict-Mode double-invoke, cross-page navigation) can never leave
// a torn file — rename is atomic on the same filesystem, so the worst case
// is last-writer-wins with a complete file.
async function atomicWrite(filePath: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${tmpCounter++}`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export function indexDbPath(galleryId: string): string {
  return path.join(indexDir(galleryId), 'sqlite.db');
}

function cachePath(galleryId: string): string {
  return path.join(indexDir(galleryId), 'exif-cache.json');
}

async function readCache(galleryId: string): Promise<CacheFile> {
  try {
    const raw = await fs.readFile(cachePath(galleryId), 'utf-8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed?.version === CACHE_VERSION && parsed.entries) return parsed;
  } catch {
    /* missing / corrupt → rebuild from scratch */
  }
  return { version: CACHE_VERSION, entries: {} };
}

async function writeCache(galleryId: string, cache: CacheFile): Promise<void> {
  await atomicWrite(cachePath(galleryId), JSON.stringify(cache));
}

// `db-meta.json` records the fingerprint the persisted sqlite.db was built
// for. Kept separate from exif-cache.json (which only speeds re-extraction)
// because it gates whether the read-back cache is valid.
function dbMetaPath(galleryId: string): string {
  return path.join(indexDir(galleryId), 'db-meta.json');
}

type DbMeta = { fingerprint: string; savedAt?: string };

async function readDbMeta(galleryId: string): Promise<DbMeta | null> {
  try {
    const raw = await fs.readFile(dbMetaPath(galleryId), 'utf-8');
    const parsed = JSON.parse(raw) as DbMeta;
    return typeof parsed?.fingerprint === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

// Cheap "is this actually a SQLite file" guard — the first 16 bytes of every
// SQLite db are this magic string. Catches truncated / garbage cache files
// before we hand them to the renderer's sql.js.
const SQLITE_MAGIC = 'SQLite format 3\0';
function isLikelySqlite(buf: Buffer): boolean {
  return buf.length >= 16 && buf.subarray(0, 16).toString('latin1') === SQLITE_MAGIC;
}

function isImage(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return false;
  return IMAGE_EXTS.has(lower.slice(dot));
}

// Skip the same junk build.py does: dotfiles and __-prefixed sidecars.
function isSkippable(name: string): boolean {
  return name.startsWith('.') || name.startsWith('__');
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

type AlbumMeta = { dir: string; name: string };

// Parse README.yml into album dirs. Mirrors the renderer's parseAlbums but
// runs in main against the on-disk file. Returns [] when README.yml is
// absent (non-PicG repo) — the index is then simply empty.
async function readAlbums(repoPath: string): Promise<AlbumMeta[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(repoPath, 'README.yml'), 'utf-8');
  } catch {
    return [];
  }
  const data = yaml.load(text, { schema: yaml.CORE_SCHEMA, json: true }) as
    | Record<string, { url?: unknown }>
    | null;
  if (!data || typeof data !== 'object') return [];
  const out: AlbumMeta[] = [];
  for (const [name, fields] of Object.entries(data)) {
    const dir = typeof fields?.url === 'string' ? fields.url : null;
    if (!dir) continue;
    out.push({ dir, name: name.trim() });
  }
  return out;
}

type ScanItem = {
  relPath: string;
  albumDir: string;
  name: string;
  livephoto: boolean;
  mtimeMs: number;
  size: number;
};

// One stat-only pass over every album's image files (no file reads). Also
// notes whether a live-photo `<name>.mov` sits beside each image. Files that
// are listed but can't be stat'd are skipped.
async function scanGallery(repoPath: string, albums: AlbumMeta[]): Promise<ScanItem[]> {
  const scan: ScanItem[] = [];
  for (const album of albums) {
    const absDir = path.join(repoPath, album.dir);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue; // album dir referenced in README.yml but missing on disk
    }
    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (isSkippable(entry.name) || !isImage(entry.name)) continue;
      const relPath = `${album.dir}/${entry.name}`;
      let st: import('node:fs').Stats;
      try {
        st = await fs.stat(path.join(repoPath, relPath));
      } catch {
        continue;
      }
      const base = baseName(entry.name);
      scan.push({
        relPath,
        albumDir: album.dir,
        name: base,
        livephoto: names.has(`${base}.mov`) || names.has(`${base}.MOV`),
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    }
  }
  return scan;
}

// Fingerprint of the current image set. Any add / remove / edit (mtime or
// size change) or live-photo sibling change flips it — i.e. it changes
// exactly when the previously-built sqlite.db is stale.
function fingerprintOf(scan: ScanItem[]): string {
  const h = createHash('sha1');
  const sorted = [...scan].sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
  );
  for (const s of sorted) {
    h.update(`${s.relPath}\0${s.mtimeMs}\0${s.size}\0${s.livephoto ? 1 : 0}\n`);
  }
  return h.digest('hex');
}

// Build the index, OR — when nothing changed since the DB was last
// persisted — return the on-disk sqlite.db verbatim (read-back cache). The
// fast path skips all EXIF work, the IPC row transfer, and the renderer
// rebuild. Emits progress so the renderer can show a determinate bar on a
// real (slow) first build.
export async function buildPhotoIndex(
  galleryId: string,
  onProgress?: ProgressFn
): Promise<PhotoIndexResult> {
  const gallery = await getRegistry().resolve(galleryId);
  if (!gallery) throw new Error(`Gallery not found: ${galleryId}`);
  const repoPath = gallery.localPath;

  const albums = await readAlbums(repoPath);
  onProgress?.({ galleryId, processed: 0, total: 0, phase: 'scan' });

  const scan = await scanGallery(repoPath, albums);
  const fingerprint = fingerprintOf(scan);

  // Read-back cache: fingerprint matches the persisted DB → hand the bytes
  // straight back. db-meta is written *after* the db (see saveIndexDb), so a
  // matching fingerprint guarantees the db on disk is the one it describes.
  // We still validate the SQLite header so a present-but-corrupt db (disk
  // corruption, truncation by an external process) falls through to a
  // rebuild — which overwrites it — instead of bricking every reopen.
  const meta = await readDbMeta(galleryId);
  if (meta && meta.fingerprint === fingerprint) {
    try {
      const buf = await fs.readFile(indexDbPath(galleryId));
      if (isLikelySqlite(buf)) {
        onProgress?.({ galleryId, processed: scan.length, total: scan.length, phase: 'done' });
        return { source: 'cache', db: new Uint8Array(buf) };
      }
      /* present but not a valid SQLite file → fall through to rebuild */
    } catch {
      /* db missing/unreadable despite fresh meta → fall through to rebuild */
    }
  }

  // Rebuild: re-extract only files whose (mtime,size) changed; reuse the
  // exif-cache for the rest.
  const total = scan.length;
  const prevCache = await readCache(galleryId);
  const nextCache: CacheFile = { version: CACHE_VERSION, entries: {} };
  const photos: PhotoIndexPhoto[] = [];
  let processed = 0;
  let dated = 0;

  for (const item of scan) {
    const abs = path.join(repoPath, item.relPath);
    const cached = prevCache.entries[item.relPath];
    let exif: PhotoExif | null;
    if (cached && cached.mtimeMs === item.mtimeMs && cached.size === item.size) {
      exif = cached.exif;
    } else {
      exif = await extractPhotoExif(abs);
    }

    nextCache.entries[item.relPath] = {
      mtimeMs: item.mtimeMs,
      size: item.size,
      livephoto: item.livephoto,
      exif,
    };

    if (exif?.date) dated += 1;
    photos.push({
      path: item.relPath,
      name: item.name,
      dir: item.albumDir,
      livephoto: item.livephoto,
      exif,
    });

    processed += 1;
    if (processed % 16 === 0 || processed === total) {
      onProgress?.({ galleryId, processed, total, phase: 'extract' });
    }
  }

  await writeCache(galleryId, nextCache).catch(() => {
    /* cache is an optimization; a failed write just means a slower next run */
  });

  onProgress?.({ galleryId, processed: total, total, phase: 'done' });

  return {
    source: 'rebuild',
    fingerprint,
    data: {
      galleryId,
      albums: albums.map((a) => ({ dir: a.dir, name: a.name })),
      photos,
      builtAt: new Date().toISOString(),
      total,
      dated,
    },
  };
}

// Persist the renderer-built sqlite.db bytes as the on-disk artifact (the
// "real sqlite.db file" — same schema as the deployed build), and record the
// fingerprint it was built for so the next buildPhotoIndex can read it back
// instead of rebuilding.
//
// Saves are serialized per galleryId: two concurrent saves (two page opens
// straddling a photo edit) would otherwise interleave their db + meta
// renames and could leave meta describing a different build than the db
// bytes. The queue makes each save's (db, meta) pair land atomically
// relative to the next.
const saveQueues = new Map<string, Promise<unknown>>();

export function saveIndexDb(
  galleryId: string,
  bytes: Uint8Array,
  fingerprint: string
): Promise<string> {
  const prev = saveQueues.get(galleryId) ?? Promise.resolve();
  const run = prev
    .catch(() => {})
    .then(() => doSaveIndexDb(galleryId, bytes, fingerprint));
  // Park a never-rejecting promise as the chain tail so the next waiter's
  // .then fires regardless of this save's outcome.
  saveQueues.set(galleryId, run.catch(() => {}));
  return run;
}

async function doSaveIndexDb(
  galleryId: string,
  bytes: Uint8Array,
  fingerprint: string
): Promise<string> {
  // galleryId arrives from the renderer; resolve it through the registry so
  // only a real managed gallery can drive a write (the same guard
  // buildPhotoIndex relies on), and indexDir() asserts path containment.
  const gallery = await getRegistry().resolve(galleryId);
  if (!gallery) throw new Error(`Gallery not found: ${galleryId}`);
  const dbPath = indexDbPath(galleryId);
  await atomicWrite(dbPath, bytes);
  // Write meta AFTER the db so a fresh fingerprint never points at a
  // missing/old db: if this second write fails, the next open sees stale
  // meta and safely rebuilds.
  await atomicWrite(
    dbMetaPath(galleryId),
    JSON.stringify({ fingerprint, savedAt: new Date().toISOString() })
  );
  return dbPath;
}

// Drop the db-meta so the next buildPhotoIndex rebuilds. Called by the
// renderer when it can't open the cached db (corrupt past the header check).
// exif-cache.json is left intact — it only speeds re-extraction.
export async function invalidateIndexCache(galleryId: string): Promise<void> {
  await fs.rm(dbMetaPath(galleryId), { force: true }).catch(() => {});
}
