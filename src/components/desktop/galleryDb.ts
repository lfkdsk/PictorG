'use client';

// Desktop equivalent of src/lib/sqlite.ts. The web flow fetches
// `${siteUrl}/sqlite.db` from the deployed gallery's CDN; in the desktop
// app we read it straight out of the local clone through the
// StorageAdapter. sql.js itself is the same — Electron's renderer is
// Chromium, so the WASM module loads exactly like it does on web.

import type { Database, SqlJsStatic } from 'sql.js';

import type { StorageAdapter } from '@/core/storage';
import type {
  AnnualSummary,
  MonthKey,
} from '@/lib/annualSummary';

const SQL_JS_VERSION = '1.14.1';
const SQL_WASM_URL = `https://cdn.jsdelivr.net/npm/sql.js@${SQL_JS_VERSION}/dist/sql-wasm.wasm`;
const DB_PATH = 'sqlite.db';
export const SUMMARY_DIR = '.analysis/annual-summary';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const initSqlJs = (await import('sql.js')).default;
      return initSqlJs({ locateFile: () => SQL_WASM_URL });
    })();
  }
  return sqlJsPromise;
}

// Process-wide cache keyed by adapter id so re-entering the page (or
// hopping between year and picker) doesn't refetch the file from disk.
// Lives across React mounts but a renderer reload drops it.
const dbCache = new Map<string, Promise<Database>>();

export async function openLocalGalleryDb(
  adapter: StorageAdapter
): Promise<Database> {
  const key = adapter.id;
  let promise = dbCache.get(key);
  if (!promise) {
    promise = (async () => {
      const SQL = await getSqlJs();
      const file = await adapter.readFile(DB_PATH);
      return new SQL.Database(file.data);
    })();
    dbCache.set(key, promise);
    promise.catch(() => dbCache.delete(key));
  }
  return promise;
}

export function clearGalleryDbCache(adapterId?: string): void {
  if (adapterId) dbCache.delete(adapterId);
  else dbCache.clear();
}

// Adapter-flavored equivalents of fetchSummary / saveSummary in
// src/lib/annualSummary.ts. Web reads/writes via fetchGitHubFile +
// updateGitHubFile; desktop goes through StorageAdapter.

export async function loadAnnualSummary(
  adapter: StorageAdapter,
  year: string
): Promise<AnnualSummary | null> {
  try {
    const meta = await adapter.readFileMetadata(`${SUMMARY_DIR}/${year}.json`);
    if (!meta) return null;
    const file = await adapter.readFile(`${SUMMARY_DIR}/${year}.json`);
    return JSON.parse(file.text()) as AnnualSummary;
  } catch {
    return null;
  }
}

export async function saveAnnualSummary(
  adapter: StorageAdapter,
  year: string,
  summary: AnnualSummary
): Promise<void> {
  const ordered: AnnualSummary = {};
  (Object.keys(summary).sort() as MonthKey[]).forEach((k) => {
    if (summary[k]) ordered[k] = summary[k];
  });
  const content = JSON.stringify(ordered, null, 2) + '\n';
  await adapter.writeFile(
    `${SUMMARY_DIR}/${year}.json`,
    content,
    `Update annual summary ${year}`
  );
}

// Lists the years that already have a saved summary file in the gallery,
// matching listExistingSummaryYears from the web flow but going through
// the adapter. Returns sorted desc.
export async function listSavedSummaryYears(
  adapter: StorageAdapter
): Promise<string[]> {
  try {
    const entries = await adapter.listDirectory(SUMMARY_DIR);
    return entries
      .filter((e) => e.type === 'file' && /^\d{4}\.json$/.test(e.name))
      .map((e) => e.name.replace(/\.json$/, ''))
      .sort((a, b) => Number(b) - Number(a));
  } catch {
    return [];
  }
}
