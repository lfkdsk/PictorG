import yaml from 'js-yaml';
import type { Database } from 'sql.js';
import {
  fetchGitHubFile,
  getFileSha,
  getRepoContents,
  updateGitHubFile,
} from '@/lib/github';

export const SUMMARY_DIR = '.analysis/annual-summary';

export type MonthKey =
  | '01' | '02' | '03' | '04' | '05' | '06'
  | '07' | '08' | '09' | '10' | '11' | '12';

export type AnnualSummary = Partial<Record<MonthKey, string>>;

export type CandidatePhoto = {
  path: string;
  name: string;
  date: string;
};

export type MonthlyCandidates = Partial<Record<MonthKey, CandidatePhoto[]>>;

export type GalleryUrlConfig = {
  siteUrl: string;
  thumbnailUrl: string;
  baseUrl: string;
  backupThumbnailUrl?: string;
  backupBaseUrl?: string;
};

export function parseGalleryConfig(yamlText: string): GalleryUrlConfig {
  const parsed = yaml.load(yamlText, { schema: yaml.CORE_SCHEMA, json: true }) as Record<
    string,
    unknown
  >;
  const siteUrl = String(parsed?.url ?? '').replace(/\/+$/, '');
  const thumbnailUrl = String(parsed?.thumbnail_url ?? '');
  const baseUrl = String(parsed?.base_url ?? '');
  if (!siteUrl) {
    throw new Error('CONFIG.yml 缺少 url 字段，无法定位 sqlite.db');
  }
  return {
    siteUrl,
    thumbnailUrl,
    baseUrl,
    backupThumbnailUrl: parsed?.backup_thumbnail_url ? String(parsed.backup_thumbnail_url) : undefined,
    backupBaseUrl: parsed?.backup_base_url ? String(parsed.backup_base_url) : undefined,
  };
}

export function listYearsWithPhotos(db: Database): string[] {
  const res = db.exec(
    `SELECT DISTINCT strftime('%Y', e.date) AS y
       FROM photo p
       JOIN exifdata e ON p.exif_data_id = e.id
      WHERE e.date IS NOT NULL
      ORDER BY y DESC`,
  );
  if (!res.length) return [];
  return res[0].values
    .map((row) => row[0])
    .filter((v): v is string => typeof v === 'string' && v.length === 4);
}

export function listMonthlyCandidates(db: Database, year: string): MonthlyCandidates {
  const res = db.exec(
    `SELECT strftime('%m', e.date) AS m,
            p.path,
            p.name,
            strftime('%Y-%m-%d', e.date) AS d
       FROM photo p
       JOIN exifdata e ON p.exif_data_id = e.id
      WHERE strftime('%Y', e.date) = $year
        AND e.date IS NOT NULL
      ORDER BY e.date ASC`,
    { $year: year },
  );
  const out: MonthlyCandidates = {};
  if (!res.length) return out;
  for (const [m, path, name, date] of res[0].values) {
    if (typeof m !== 'string' || typeof path !== 'string') continue;
    const key = m as MonthKey;
    const list = out[key] ?? (out[key] = []);
    list.push({
      path,
      name: typeof name === 'string' ? name : path,
      date: typeof date === 'string' ? date : '',
    });
  }
  return out;
}

export function thumbnailUrlFor(cfg: GalleryUrlConfig, photoPath: string): string {
  const base = (cfg.thumbnailUrl || cfg.backupThumbnailUrl || cfg.baseUrl || '').replace(/\/+$/, '');
  const webpPath = photoPath.replace(/\.\w+$/, '.webp');
  const encoded = webpPath.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${base}/${encoded}`;
}

export async function listExistingSummaryYears(
  token: string,
  owner: string,
  repo: string,
): Promise<string[]> {
  const items = await getRepoContents(token, owner, repo, SUMMARY_DIR);
  return items
    .filter((item: any) => item?.type === 'file' && /^\d{4}\.json$/.test(item.name))
    .map((item: any) => item.name.replace(/\.json$/, ''));
}

export async function fetchSummary(
  token: string,
  owner: string,
  repo: string,
  year: string,
): Promise<AnnualSummary | null> {
  try {
    const text = await fetchGitHubFile(token, owner, repo, `${SUMMARY_DIR}/${year}.json`);
    return JSON.parse(text) as AnnualSummary;
  } catch {
    return null;
  }
}

export async function saveSummary(
  token: string,
  owner: string,
  repo: string,
  year: string,
  summary: AnnualSummary,
  message?: string,
): Promise<void> {
  const path = `${SUMMARY_DIR}/${year}.json`;
  const sha = await getFileSha(token, owner, repo, path);
  const ordered: AnnualSummary = {};
  (Object.keys(summary).sort() as MonthKey[]).forEach((k) => {
    const v = summary[k];
    if (v) ordered[k] = v;
  });
  const content = JSON.stringify(ordered, null, 2) + '\n';
  await updateGitHubFile(
    token,
    owner,
    repo,
    path,
    content,
    message ?? `Update annual-summary ${year} via PicG`,
    sha,
  );
}
