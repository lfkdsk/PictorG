// EXIF extraction for the local photo index. The deployed gallery's
// sqlite.db is built by album_template's build.py (exifread + Pillow);
// this is the desktop-local equivalent so the timeline / annual-summary
// / stats pages reflect the actual on-disk repo — including photos that
// haven't been pushed + deployed yet.
//
// We reuse @lfkdsk/exif-library's `load()` — the same lib compress.ts
// already drives in the main process. It reads the EXIF segment straight
// out of JPEG **and WebP** (verified against the user's Fujifilm/iPhone
// webps), returning IFDs keyed by tag number in piexif format:
//   - strings (Make/Model/LensModel/DateTimeOriginal) → JS strings
//   - rationals (FNumber/ExposureTime/FocalLength)    → [num, den]
//   - GPS coords                                       → [[d,1],[m,1],[s,den]]
//
// Field semantics mirror tool.py's to_exif_date / read_gps so the rows we
// produce slot into the same schema the existing sql.js queries expect.

import { promises as fs } from 'node:fs';
import { load, TagNumbers, GPSHelper } from '@lfkdsk/exif-library';

import type { PhotoIndexExif } from '../../src/core/storage/electron/galleryTypes';

const { ImageIFD, ExifIFD, GPSIFD } = TagNumbers;

// One photo's extracted EXIF — the wire shape shared with the renderer.
// All fields are nullable: a screenshot or a stripped webp yields an
// all-null record, which still becomes a `photo` row (just without an
// `exifdata` row, so it sorts under "Unknown" in the timeline, exactly
// like build.py's nullable exif_data FK).
export type PhotoExif = PhotoIndexExif;

type Ifd = Record<number, unknown>;

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\0+$/, '').trim();
  return t.length ? t : null;
}

// piexif rationals are [num, den]; tolerate a bare number too.
function ratio(v: unknown): number | null {
  if (Array.isArray(v) && v.length === 2) {
    const [n, d] = v as [number, number];
    if (typeof n === 'number' && typeof d === 'number' && d !== 0) return n / d;
    return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

// Mirror Python's `str(round(x, 1))`: always one decimal place (eval()
// of "140/1" yields a float there, so 140 → "140.0", 2.8 → "2.8").
function round1(x: number): string {
  return x.toFixed(1);
}

// EXIF DateTimeOriginal is 'YYYY:MM:DD HH:MM:SS'. SQLite's date funcs need
// dashes in the date part — convert just those two colons. Returns null if
// the value isn't a well-formed datetime (e.g. all-zero placeholder).
function normalizeExifDate(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const [, y, mo, d, time] = m;
  if (y === '0000' || mo === '00' || d === '00') return null;
  return `${y}-${mo}-${d} ${time}`;
}

// exifread normalizes iPhone-style fractional exposures ("10/300" → "1/30");
// replicate from a [num, den] rational. Guards a zero numerator (some
// cameras write 0/1 as "unknown" — without the guard `Math.round(d/0)`
// emits the literal "1/Infinity") and keeps whole-second exposures integral
// ([1,1] → "1", not "1/1").
function formatExposure(v: unknown): string | null {
  if (Array.isArray(v) && v.length === 2) {
    const [n, d] = v as [number, number];
    if (typeof n !== 'number' || typeof d !== 'number' || d === 0 || n === 0) {
      return null;
    }
    if (n % d === 0) return String(n / d); // 1s, 2s, … stay integers
    if (n === 1) return `1/${d}`;
    return `1/${Math.round(d / n)}`;
  }
  const r = ratio(v);
  return r == null || r === 0 ? null : String(r);
}

function isoToStr(v: unknown): string | null {
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first === 'number' && Number.isFinite(first)) return String(first);
  return null;
}

function gpsDegrees(gps: Ifd, coordTag: number, refTag: number): number | null {
  const coord = gps[coordTag];
  const ref = gps[refTag];
  if (!Array.isArray(coord)) return null;
  try {
    const deg = GPSHelper.dmsRationalToDeg(coord as never, (ref as string) ?? '');
    return Number.isFinite(deg) ? deg : null;
  } catch {
    return null;
  }
}

// Parse an already-loaded EXIF dict into our PhotoExif shape. Split out from
// the file read so it can be unit-tested without touching disk.
export function exifFromLoaded(exif: {
  '0th'?: Ifd;
  Exif?: Ifd;
  GPS?: Ifd;
}): PhotoExif {
  const zero = exif['0th'] ?? {};
  const ex = exif.Exif ?? {};
  const gps = exif.GPS ?? {};

  const maker = str(zero[ImageIFD.Make]);
  const model = str(zero[ImageIFD.Model]);
  const lensModel = str(ex[ExifIFD.LensModel]);

  // DateTimeOriginal is build.py's source of truth; fall back to Digitized
  // then the 0th DateTime so images with only those still land on the
  // timeline instead of "Unknown".
  const date =
    normalizeExifDate(ex[ExifIFD.DateTimeOriginal]) ??
    normalizeExifDate(ex[ExifIFD.DateTimeDigitized]) ??
    normalizeExifDate(zero[ImageIFD.DateTime]);

  const fNum = ratio(ex[ExifIFD.FNumber]);
  const focal = ratio(ex[ExifIFD.FocalLength]);
  const fNumber = fNum == null ? null : round1(fNum);
  const focalLength = focal == null ? null : round1(focal);
  const exposureTime = formatExposure(ex[ExifIFD.ExposureTime]);
  const iso = isoToStr(ex[ExifIFD.ISOSpeedRatings]);

  let gpsCoord: { lat: number; lon: number } | null = null;
  const lat = gpsDegrees(gps, GPSIFD.GPSLatitude, GPSIFD.GPSLatitudeRef);
  const lon = gpsDegrees(gps, GPSIFD.GPSLongitude, GPSIFD.GPSLongitudeRef);
  if (lat != null && lon != null) gpsCoord = { lat, lon };

  const parts = [
    maker,
    model,
    focalLength ? `${focalLength}mm` : null,
    fNumber ? `F${fNumber}` : null,
    exposureTime ? `${exposureTime}s` : null,
    iso ? `ISO ${iso}` : null,
    lensModel,
  ].filter(Boolean);

  return {
    date,
    maker,
    model,
    lensModel,
    fNumber,
    exposureTime,
    iso,
    focalLength,
    exifText: parts.join(' '),
    gps: gpsCoord,
  };
}

// Read + parse a single image's EXIF. Returns null only when the file
// can't be read or has no parseable EXIF segment at all; a file with a
// segment but no useful tags returns an all-null PhotoExif (still indexed).
//
// We read the whole file: WebP stores its EXIF chunk at a non-fixed offset,
// so a prefix read isn't reliable. Cost is amortized by the per-file cache
// in indexer.ts (unchanged files are never re-read).
export async function extractPhotoExif(absPath: string): Promise<PhotoExif | null> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath);
  } catch {
    return null;
  }
  let loaded: { '0th'?: Ifd; Exif?: Ifd; GPS?: Ifd };
  try {
    loaded = load(buf.toString('binary')) as never;
  } catch {
    return null;
  }
  return exifFromLoaded(loaded);
}
