'use client';

// Desktop adapter-flavored helpers around the existing web sqlite.ts /
// annualSummary.ts. The sqlite.db itself is a CI-built derivative
// (template + theme + scan) that lives on the deployed site, NOT in
// the gallery repo — so desktop reads it from the same CDN URL the web
// flow uses. Building the DB locally would mean owning the rendering
// layer (template / theme / build.py), which is firmly outside the
// desktop tool's scope.

import type { Database } from 'sql.js';

import type { StorageAdapter } from '@/core/storage';
import {
  parseGalleryConfig,
  type AnnualSummary,
  type MonthKey,
} from '@/lib/annualSummary';
import { openGalleryDb } from '@/lib/sqlite';

export const SUMMARY_DIR = '.analysis/annual-summary';
const CONFIG_PATH = 'CONFIG.yml';

// Reads CONFIG.yml from the local clone, pulls the deployed site URL,
// then loads sqlite.db from that site's CDN through the shared
// openGalleryDb cache. Throws "CONFIG.yml 缺少 url 字段" if the gallery
// hasn't been configured for deployment.
export async function openDeployedGalleryDb(
  adapter: StorageAdapter
): Promise<Database> {
  const file = await adapter.readFile(CONFIG_PATH);
  const cfg = parseGalleryConfig(file.text());
  return openGalleryDb(cfg.siteUrl);
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
