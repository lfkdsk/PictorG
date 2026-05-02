import type { StorageAdapter } from '@/core/storage';

import type { CountRow } from './galleryStats';

// Reads gallery/.analysis/animal_index.json out of the local clone and
// rolls it up into a {label, count} list ready for StatList. The JSON
// is produced by an upstream species-tagging tool and isn't written
// into sqlite.db, so this is the only path that surfaces it on the
// desktop. Missing or unparseable file → empty list (silent).
//
// Key shape produced by the upstream tool: "中文 / English". Underscore
// prefixed keys are metadata (build.py skips them too).

const ANIMAL_INDEX_PATH = '.analysis/animal_index.json';

export async function loadAnimalCounts(
  adapter: StorageAdapter,
  limit = 0,
): Promise<CountRow[]> {
  const meta = await adapter.readFileMetadata(ANIMAL_INDEX_PATH);
  if (!meta) return [];

  let parsed: unknown;
  try {
    const file = await adapter.readFile(ANIMAL_INDEX_PATH);
    parsed = JSON.parse(file.text());
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const rows: CountRow[] = [];
  for (const [key, paths] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.startsWith('_')) continue;
    if (!Array.isArray(paths) || paths.length === 0) continue;
    rows.push({ ...speciesLabel(key), count: paths.length });
  }
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function speciesLabel(key: string): { label: string; subLabel?: string } {
  const idx = key.indexOf(' / ');
  if (idx === -1) return { label: key.trim() || key };
  const zh = key.slice(0, idx).trim();
  const en = key.slice(idx + 3).trim();
  if (zh && en) return { label: zh, subLabel: en };
  return { label: zh || en || key };
}
