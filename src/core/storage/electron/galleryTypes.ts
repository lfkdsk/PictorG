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
