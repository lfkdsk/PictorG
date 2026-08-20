// README.yml is shared ground. PictorG's album editor owns a handful of keys,
// but `build.py` in the deployed gallery reads several more — `layout`,
// `hidden`, `subtitle` — that are only ever set by hand. Rebuilding an entry
// from the edit form therefore has to carry the unmanaged keys across;
// otherwise tweaking a cover silently reverts someone's `layout: spread` with
// no error to notice.
//
// Key order matters too: README.yml's order is the album order on the
// deployed site, so an edit has to leave the entry where it was rather than
// deleting and re-appending it (which is what a rename used to do).

/**
 * The keys the album edit form is authoritative for. Anything else found in an
 * entry is passed through untouched. Managed keys come wholly from the form,
 * so clearing a field (e.g. removing a location) really does clear it.
 */
export const MANAGED_ALBUM_KEYS = ['url', 'date', 'style', 'cover', 'location'] as const;

const MANAGED = new Set<string>(MANAGED_ALBUM_KEYS);

export type AlbumEntry = Record<string, unknown>;
export type ReadmeData = Record<string, AlbumEntry>;

/** Thrown when a rename would land on an album that already exists. */
export class AlbumNameCollisionError extends Error {
  constructor(public readonly name: string) {
    super(`Another album already uses the name "${name}".`);
    this.name = 'AlbumNameCollisionError';
  }
}

function isPlainEntry(v: unknown): v is AlbumEntry {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Write `entry` into `data` under `newName`, renaming from `oldName` if given.
 *
 * Returns a new object; `data` is not mutated. The entry keeps its original
 * position, and any keys outside {@link MANAGED_ALBUM_KEYS} on the previous
 * entry are preserved.
 *
 * @throws {AlbumNameCollisionError} if `newName` is already a *different* album
 */
export function upsertAlbumEntry(
  data: ReadmeData,
  { oldName, newName, entry }: { oldName?: string | null; newName: string; entry: AlbumEntry }
): ReadmeData {
  const prevKey = oldName && Object.prototype.hasOwnProperty.call(data, oldName) ? oldName : null;

  if (newName !== prevKey && Object.prototype.hasOwnProperty.call(data, newName)) {
    throw new AlbumNameCollisionError(newName);
  }

  const prev = prevKey ? data[prevKey] : undefined;
  const carried: AlbumEntry = {};
  if (isPlainEntry(prev)) {
    for (const [k, v] of Object.entries(prev)) {
      if (!MANAGED.has(k)) carried[k] = v;
    }
  }
  // Managed keys come from the form, carried keys are ones we never touch, so
  // the two sets cannot overlap — spread order here is only about which keys
  // read first in the emitted YAML.
  const merged: AlbumEntry = { ...entry, ...carried };

  const out: ReadmeData = {};
  let placed = false;
  for (const [k, v] of Object.entries(data)) {
    if (k === prevKey) {
      out[newName] = merged;
      placed = true;
    } else {
      out[k] = v;
    }
  }
  if (!placed) out[newName] = merged;
  return out;
}
