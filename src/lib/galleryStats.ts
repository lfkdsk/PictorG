import type { Database } from 'sql.js';

// Gallery-wide stats queries — mirror of the deployed theme's
// layout/status.ejs page, ported to sql.js so the desktop can read
// them out of the same CI-built sqlite.db. Schema lives at:
//   photo(exif_data_id, livephoto, path, name, location_id)
//   exifdata(id, date, maker, lens_model, focal_length, exposure_time, f_number)
//   location(id, country)

export type CountRow = { label: string; subLabel?: string; count: number };

export type TodayPhoto = {
  path: string;
  name: string;
  date: string;
};

export type DailyCount = { date: string; count: number };

export type HeatmapYear = {
  year: string;
  days: DailyCount[];
  max: number;
};

function pickRows(db: Database, sql: string): unknown[][] {
  const res = db.exec(sql);
  return res.length ? res[0].values : [];
}

export function countTotalPhotos(db: Database): number {
  const rows = pickRows(db, `SELECT COUNT(*) FROM photo`);
  return Number(rows[0]?.[0] ?? 0);
}

export function countLivePhotos(db: Database): number {
  const rows = pickRows(db, `SELECT COUNT(*) FROM photo WHERE livephoto = 1`);
  return Number(rows[0]?.[0] ?? 0);
}

function rowsToCountList(rows: unknown[][]): CountRow[] {
  const out: CountRow[] = [];
  for (const [label, count] of rows) {
    const text = label == null || label === '' ? 'NONE' : String(label);
    out.push({ label: text, count: Number(count ?? 0) });
  }
  return out;
}

export function groupByMaker(db: Database): CountRow[] {
  return rowsToCountList(
    pickRows(
      db,
      `SELECT IFNULL(e.maker, 'NONE') AS maker, COUNT(*) AS count
         FROM photo p
         LEFT OUTER JOIN exifdata e ON p.exif_data_id = e.id
        GROUP BY maker
        ORDER BY count DESC`,
    ),
  );
}

export function topLensModels(db: Database, limit = 10): CountRow[] {
  return rowsToCountList(
    pickRows(
      db,
      `SELECT lens_model, COUNT(*) AS count
         FROM exifdata
        GROUP BY lens_model
        ORDER BY count DESC
        LIMIT ${limit}`,
    ),
  );
}

export function groupByCountry(db: Database): CountRow[] {
  return rowsToCountList(
    pickRows(
      db,
      `SELECT COALESCE(NULLIF(country, ''), 'NONE') AS country, COUNT(*) AS count
         FROM location
        GROUP BY country
        ORDER BY count DESC`,
    ),
  );
}

export function topFocalLengths(db: Database, limit = 5): CountRow[] {
  return rowsToCountList(
    pickRows(
      db,
      `SELECT e.focal_length, COUNT(*) AS count
         FROM photo p
         LEFT OUTER JOIN exifdata e ON p.exif_data_id = e.id
        WHERE p.exif_data_id IS NOT NULL
        GROUP BY e.focal_length
        ORDER BY count DESC
        LIMIT ${limit}`,
    ),
  );
}

export function topExposureTimes(db: Database, limit = 5): CountRow[] {
  return rowsToCountList(
    pickRows(
      db,
      `SELECT e.exposure_time, COUNT(*) AS count
         FROM photo p
         LEFT OUTER JOIN exifdata e ON p.exif_data_id = e.id
        WHERE p.exif_data_id IS NOT NULL
        GROUP BY e.exposure_time
        ORDER BY count DESC
        LIMIT ${limit}`,
    ),
  );
}

export function topApertures(db: Database, limit = 5): CountRow[] {
  return rowsToCountList(
    pickRows(
      db,
      `SELECT e.f_number, COUNT(*) AS count
         FROM photo p
         LEFT OUTER JOIN exifdata e ON p.exif_data_id = e.id
        WHERE p.exif_data_id IS NOT NULL AND e.f_number IS NOT NULL
        GROUP BY e.f_number
        ORDER BY count DESC
        LIMIT ${limit}`,
    ),
  );
}

export function todaysPhotosInHistory(db: Database, now: Date = new Date()): TodayPhoto[] {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const res = db.exec(
    `SELECT p.path, p.name, strftime('%Y-%m-%d', e.date) AS d
       FROM photo p
       JOIN exifdata e ON p.exif_data_id = e.id
      WHERE strftime('%m', e.date) = $month
        AND strftime('%d', e.date) = $day
      ORDER BY e.date DESC`,
    { $month: month, $day: day },
  );
  if (!res.length) return [];
  const out: TodayPhoto[] = [];
  for (const [path, name, date] of res[0].values) {
    if (typeof path !== 'string') continue;
    out.push({
      path,
      name: typeof name === 'string' ? name : path,
      date: typeof date === 'string' ? date : '',
    });
  }
  return out;
}

export function dailyCountsByYear(db: Database): HeatmapYear[] {
  const res = db.exec(
    `SELECT strftime('%Y-%m-%d', e.date) AS d, COUNT(*) AS cnt
       FROM photo p
       JOIN exifdata e ON p.exif_data_id = e.id
      WHERE e.date IS NOT NULL
      GROUP BY strftime('%Y-%m-%d', e.date)
      ORDER BY d ASC`,
  );
  if (!res.length) return [];
  const byYear = new Map<string, DailyCount[]>();
  for (const [d, cnt] of res[0].values) {
    if (typeof d !== 'string' || d.length !== 10) continue;
    const year = d.slice(0, 4);
    const list = byYear.get(year) ?? [];
    if (list.length === 0) byYear.set(year, list);
    list.push({ date: d, count: Number(cnt ?? 0) });
  }
  const out: HeatmapYear[] = [];
  for (const [year, days] of byYear) {
    let max = 0;
    for (const d of days) if (d.count > max) max = d.count;
    out.push({ year, days, max });
  }
  out.sort((a, b) => Number(b.year) - Number(a.year));
  return out;
}

export type GalleryStatsSnapshot = {
  totalPhotos: number;
  livePhotos: number;
  makers: CountRow[];
  lenses: CountRow[];
  countries: CountRow[];
  focalLengths: CountRow[];
  exposureTimes: CountRow[];
  apertures: CountRow[];
  todayInHistory: TodayPhoto[];
  heatmap: HeatmapYear[];
};

export function loadGalleryStats(db: Database): GalleryStatsSnapshot {
  return {
    totalPhotos: countTotalPhotos(db),
    livePhotos: countLivePhotos(db),
    makers: groupByMaker(db),
    lenses: topLensModels(db, 10),
    countries: groupByCountry(db),
    focalLengths: topFocalLengths(db, 5),
    exposureTimes: topExposureTimes(db, 5),
    apertures: topApertures(db, 5),
    todayInHistory: todaysPhotosInHistory(db),
    heatmap: dailyCountsByYear(db),
  };
}
