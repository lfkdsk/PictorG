// Shared between the Electron main process and the Next renderer. Both sides
// import this file directly — keep it pure types, no runtime code, so the
// renderer (which doesn't know about Node) doesn't accidentally pull in
// anything Electron-specific.

export interface LocalGallery {
  id: string;            // `${owner}__${repo}` — stable, filesystem-safe
  owner: string;
  repo: string;
  fullName: string;      // owner/repo
  htmlUrl: string;
  cloneUrl: string;      // https://github.com/owner/repo.git
  localPath: string;     // <userData>/galleries/<id>
  defaultBranch?: string;
  addedAt: string;       // ISO timestamp
  lastSyncAt?: string;
  sizeBytes?: number;    // measured on clone + sync; UI shows on cards
}

export type CloneStage =
  | 'receiving'
  | 'resolving'
  | 'writing'
  | 'compressing'
  | 'other';

export type CloneProgress = {
  galleryId: string;
  stage: CloneStage;
  percent: number;       // 0-100
  processed?: number;
  total?: number;
  // Repo metadata so a renderer that mounts mid-clone (e.g. user
  // navigated away and came back) can rebuild its UI from a single
  // event instead of needing prior context. Always present on events
  // the registry emits; older event shapes without it are still valid.
  fullName?: string;
  htmlUrl?: string;
};

// Snapshot of a clone the registry is currently running. Returned by
// `gallery.listInFlight()` so the page can rehydrate its progress UI
// after navigating away and back — clones run in main and survive the
// renderer unmount, but the per-page useState that drove the UI does not.
export type InFlightClone = {
  galleryId: string;
  fullName: string;
  htmlUrl: string;
  lastProgress?: CloneProgress;
};

// --- Local photo index ---------------------------------------------------
// Wire shapes for the desktop-local EXIF index. Main (electron/photoIndex/)
// extracts these from the on-disk clone and ships them over IPC; the
// renderer (src/lib/localGalleryDb.ts) turns them into a real sql.js
// sqlite.db whose schema matches album_template's build.py output, so the
// existing annualSummary / galleryStats queries run against it unchanged.
// Kept here (pure types) because both sides import it.

// Per-photo EXIF. All fields nullable — a stripped/EXIF-less image still
// becomes a `photo` row (no `exifdata` row), landing under "Unknown" in the
// timeline. Pure values (no F/ISO/mm/s prefixes) mirror build.py's columns.
export type PhotoIndexExif = {
  date: string | null; // 'YYYY-MM-DD HH:MM:SS'
  maker: string | null;
  model: string | null;
  lensModel: string | null;
  fNumber: string | null; // '2.8'
  exposureTime: string | null; // '1/420'
  iso: string | null; // '2000'
  focalLength: string | null; // '140.0'
  exifText: string; // prefixed, human-readable
  gps: { lat: number; lon: number } | null;
};

export type PhotoIndexAlbum = {
  dir: string; // album directory / README.yml `url`
  name: string; // README.yml display key
};

export type PhotoIndexPhoto = {
  path: string; // repo-relative, e.g. 'ReLiveSanJose/DSCF0379.webp'
  name: string; // basename without extension
  dir: string; // owning album dir
  livephoto: boolean; // a sibling `<name>.mov` exists
  exif: PhotoIndexExif | null;
};

export type PhotoIndexData = {
  galleryId: string;
  albums: PhotoIndexAlbum[];
  photos: PhotoIndexPhoto[];
  builtAt: string; // ISO timestamp
  total: number; // photo count
  dated: number; // photos with a usable EXIF date
};

export type PhotoIndexProgress = {
  galleryId: string;
  processed: number;
  total: number;
  phase: 'scan' | 'extract' | 'done';
};

// What `photoIndex.build` returns. When nothing changed since the DB was
// last persisted, main hands back the on-disk sqlite.db bytes verbatim
// (read-back cache — no EXIF re-read, no row transfer, no rebuild). When
// something changed it returns the rows for the renderer to rebuild from,
// plus the `fingerprint` it must echo back in saveDb so the next open can
// detect freshness.
export type PhotoIndexResult =
  | { source: 'cache'; db: Uint8Array }
  | { source: 'rebuild'; data: PhotoIndexData; fingerprint: string };
