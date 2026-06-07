'use client';

// Builds a real in-memory sqlite.db from the desktop-local photo index and
// hands it back as a sql.js Database. Schema matches album_template's
// build.py output (album / location / exifdata / photo), so the existing
// annualSummary + galleryStats queries run against it unchanged — but the
// data now comes from the on-disk clone (including un-pushed photos), not
// the CDN-deployed DB.
//
// Division of labour: main (electron/photoIndex/) does the file walk + EXIF
// extraction and returns plain rows; we assemble the DB here (sql.js lives
// only in the renderer bundle, per electron-builder's asar exclusion), then
// ship the exported bytes back to main to persist as the on-disk artifact.

import type { Database, SqlJsStatic } from 'sql.js';

import type {
  PhotoIndexData,
  PhotoIndexProgress,
  PicgBridge,
} from '@/core/storage';
import { getSqlJs } from './sqlite';

// SQLite identifiers are case-insensitive, so these lowercase names answer
// both the existing queries (`FROM photo p ... e.exif_data_id`) and the
// deployed theme's grid-lanes SQL (`FROM Photo ... EXIFData.date`).
const SCHEMA = `
CREATE TABLE album (id INTEGER PRIMARY KEY, dir TEXT, name TEXT);
CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE location (id INTEGER PRIMARY KEY, lo REAL, hi REAL, country TEXT);
CREATE TABLE exifdata (
  id INTEGER PRIMARY KEY,
  maker TEXT, model TEXT, exposure_time TEXT, f_number TEXT,
  iso TEXT, focal_length TEXT, date TEXT, lens_model TEXT
);
CREATE TABLE photo (
  id INTEGER PRIMARY KEY,
  path TEXT, name TEXT, dir_id INTEGER, exif TEXT,
  location_id INTEGER, livephoto INTEGER, exif_data_id INTEGER,
  desc TEXT, tag_id INTEGER
);
`;

// Assemble a Database from index rows. Pure (no IPC) so it can be unit
// tested. IDs are assigned explicitly to avoid last_insert_rowid round
// trips. `location.lo` is latitude, `hi` is longitude — matching tool.py's
// to_location and the grid-lanes reader (row.lo→lat, row.hi→lon).
export function buildDbFromIndex(SQL: SqlJsStatic, data: PhotoIndexData): Database {
  const db = new SQL.Database();
  db.run(SCHEMA);
  db.run('BEGIN TRANSACTION');

  const albumIds = new Map<string, number>();
  const insAlbum = db.prepare('INSERT INTO album (id, dir, name) VALUES (?, ?, ?)');
  data.albums.forEach((a, i) => {
    const id = i + 1;
    albumIds.set(a.dir, id);
    insAlbum.run([id, a.dir, a.name]);
  });
  insAlbum.free();

  const insExif = db.prepare(
    `INSERT INTO exifdata
       (id, maker, model, exposure_time, f_number, iso, focal_length, date, lens_model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insLoc = db.prepare(
    'INSERT INTO location (id, lo, hi, country) VALUES (?, ?, ?, ?)'
  );
  const insPhoto = db.prepare(
    `INSERT INTO photo
       (id, path, name, dir_id, exif, location_id, livephoto, exif_data_id, desc, tag_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let exifId = 0;
  let locId = 0;
  data.photos.forEach((p, i) => {
    const photoId = i + 1;
    const ex = p.exif;

    // exifdata row whenever we have a usable date — that's what puts the
    // photo on the timeline. Photos without a date get a NULL exif_data_id
    // and sort under "Unknown", exactly like the deployed build.
    let exifFk: number | null = null;
    if (ex && ex.date) {
      exifFk = ++exifId;
      insExif.run([
        exifFk,
        ex.maker,
        ex.model,
        ex.exposureTime,
        ex.fNumber,
        ex.iso,
        ex.focalLength,
        ex.date,
        ex.lensModel,
      ]);
    }

    let locFk: number | null = null;
    if (ex && ex.gps) {
      locFk = ++locId;
      insLoc.run([locFk, ex.gps.lat, ex.gps.lon, '']);
    }

    insPhoto.run([
      photoId,
      p.path,
      p.name,
      albumIds.get(p.dir) ?? null,
      ex?.exifText ?? '',
      locFk,
      p.livephoto ? 1 : 0,
      exifFk,
      '',
      null,
    ]);
  });

  insExif.free();
  insLoc.free();
  insPhoto.free();
  db.run('COMMIT');
  return db;
}

// Full flow: ask main for the index. On a cache hit (nothing changed) main
// returns the persisted sqlite.db bytes, which we open verbatim — no
// rebuild, no re-save. On a rebuild we assemble the DB from rows and persist
// it (+ its fingerprint) for next time. `onProgress` fires during the
// main-side extraction (effectively instant on a cache hit).
export async function buildLocalGalleryDb(
  bridge: PicgBridge,
  galleryId: string,
  onProgress?: (p: PhotoIndexProgress) => void
): Promise<Database> {
  const unsubscribe = onProgress
    ? bridge.photoIndex.onProgress((p) => {
        if (p.galleryId === galleryId) onProgress(p);
      })
    : null;

  // Build the DB from rows and persist it (+ fingerprint) for the read-back
  // cache. Fire-and-forget save: the returned DB is already the session's
  // source of truth.
  const persistRebuild = (SQL: SqlJsStatic, data: PhotoIndexData, fingerprint: string): Database => {
    const db = buildDbFromIndex(SQL, data);
    try {
      const bytes = db.export();
      void bridge.photoIndex.saveDb(galleryId, bytes, fingerprint).catch(() => {});
    } catch {
      /* export failed — non-fatal */
    }
    return db;
  };

  const toBytes = (db: Uint8Array): Uint8Array =>
    db instanceof Uint8Array ? db : new Uint8Array(db);

  try {
    const result = await bridge.photoIndex.build(galleryId);
    const SQL = await getSqlJs();

    if (result.source === 'cache') {
      try {
        // Read-back cache: open the on-disk sqlite.db straight from its bytes.
        return new SQL.Database(toBytes(result.db));
      } catch {
        // Cached db unreadable (corrupt past main's header check). Invalidate
        // it and rebuild once so the gallery self-heals instead of bricking
        // on every reopen.
        await bridge.photoIndex.invalidate(galleryId).catch(() => {});
        const fresh = await bridge.photoIndex.build(galleryId);
        return fresh.source === 'rebuild'
          ? persistRebuild(SQL, fresh.data, fresh.fingerprint)
          : new SQL.Database(toBytes(fresh.db));
      }
    }

    return persistRebuild(SQL, result.data, result.fingerprint);
  } finally {
    unsubscribe?.();
  }
}

// Alias kept for the stats / annual-summary call sites. Same behaviour as
// buildLocalGalleryDb — the local replacement for galleryDb.ts's
// openDeployedGalleryDb (the deployed-DB path now only backs the web flow,
// which has no local files).
export async function openLocalGalleryDb(
  bridge: PicgBridge,
  galleryId: string,
  onProgress?: (p: PhotoIndexProgress) => void
): Promise<Database> {
  return buildLocalGalleryDb(bridge, galleryId, onProgress);
}
