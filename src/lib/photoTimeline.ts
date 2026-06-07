import type { Database } from 'sql.js';

// One photo as the timeline renders it. Mirrors the deployed grid-lanes
// query: all photos newest-first, dateless ones (no EXIF date) pushed to
// the end as "Unknown".

export type TimelinePhoto = {
  path: string; // repo-relative — feeds picg:// thumbnails
  name: string;
  date: string | null; // 'YYYY-MM-DD' or null when undated
  dateTime: string | null; // full 'YYYY-MM-DD HH:MM:SS'
  maker: string | null;
  model: string | null;
  lensModel: string | null;
  focalLength: string | null;
  fNumber: string | null;
  exposureTime: string | null;
  iso: string | null;
  livephoto: boolean;
};

function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function listTimelinePhotos(db: Database): TimelinePhoto[] {
  const res = db.exec(
    `SELECT photo.path, photo.name,
            DATE(exifdata.date) AS d,
            exifdata.date,
            exifdata.maker, exifdata.model, exifdata.lens_model,
            exifdata.focal_length, exifdata.f_number, exifdata.exposure_time,
            exifdata.iso, photo.livephoto
       FROM photo
       LEFT JOIN exifdata ON photo.exif_data_id = exifdata.id
      ORDER BY CASE WHEN exifdata.date IS NULL THEN 1 ELSE 0 END,
               exifdata.date DESC, photo.id DESC`
  );
  if (!res.length) return [];
  const out: TimelinePhoto[] = [];
  for (const row of res[0].values) {
    const path = row[0];
    if (typeof path !== 'string') continue;
    out.push({
      path,
      name: typeof row[1] === 'string' ? row[1] : path,
      date: s(row[2]),
      dateTime: s(row[3]),
      maker: s(row[4]),
      model: s(row[5]),
      lensModel: s(row[6]),
      focalLength: s(row[7]),
      fNumber: s(row[8]),
      exposureTime: s(row[9]),
      iso: s(row[10]),
      livephoto: Number(row[11] ?? 0) === 1,
    });
  }
  return out;
}

// One geotagged photo for the map. lat/lon come from the `location` table
// (lo = latitude, hi = longitude — see tool.py's to_location).
export type GeoPhoto = {
  path: string;
  name: string;
  lat: number;
  lon: number;
  date: string | null; // 'YYYY-MM-DD' or null
};

export function listGeotaggedPhotos(db: Database): GeoPhoto[] {
  const res = db.exec(
    `SELECT photo.path, photo.name, location.lo, location.hi,
            DATE(exifdata.date) AS d
       FROM photo
       JOIN location ON photo.location_id = location.id
       LEFT JOIN exifdata ON photo.exif_data_id = exifdata.id
      WHERE location.lo IS NOT NULL AND location.hi IS NOT NULL
      ORDER BY CASE WHEN exifdata.date IS NULL THEN 1 ELSE 0 END,
               exifdata.date DESC, photo.id DESC`
  );
  if (!res.length) return [];
  const out: GeoPhoto[] = [];
  for (const row of res[0].values) {
    const path = row[0];
    const lat = Number(row[2]);
    const lon = Number(row[3]);
    if (
      typeof path !== 'string' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      continue; // drop garbage coords so they don't distort fitBounds
    }
    out.push({
      path,
      name: typeof row[1] === 'string' ? row[1] : path,
      lat,
      lon,
      date: s(row[4]),
    });
  }
  return out;
}

// Friendly label for the floating date indicator. Groups by day; undated
// photos read "Unknown".
export function formatTimelineDate(date: string | null): string {
  if (!date) return 'Unknown';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
