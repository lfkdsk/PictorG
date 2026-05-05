// IPC contract shared between the main process (handlers in ipc/) and the
// preload script (window.picgBridge in preload.ts).
//
// Methods are namespaced by channel; payloads use plain serializable types so
// they survive Electron's structured-clone IPC.

import type {
  BatchFile,
  BranchOptions,
  DirectoryEntry,
  FileMetadata,
  WriteContent,
  WriteOptions,
} from '../../src/core/storage/types';
import type {
  CloneProgress,
  InFlightClone,
  LocalGallery,
  MigrateDirection,
  MigrateProgress,
} from '../../src/core/storage/electron/galleryTypes';

export const CHANNELS = {
  pickGalleryDir: 'gallery:pick-dir',
  auth: {
    openExternal: 'auth:open-external',
    oauthCallback: 'auth:oauth-callback',
    saveToken: 'auth:save-token',
    getToken: 'auth:get-token',
    clearToken: 'auth:clear-token',
  },
  compress: {
    image: 'compress:image',
  },
  updater: {
    // Renderer → main: open the GitHub release page in the user's
    // default browser. The Topbar "vX.Y.Z available — Download" pill
    // calls this; we ship unsigned macOS builds, so users grab the
    // new DMG manually rather than the (broken-without-signing)
    // electron-updater silent install path.
    openReleasePage: 'updater:open-release-page',
    // Main → renderer broadcast: a newer version is available.
    // Payload is { version, releaseUrl } — the renderer pill uses
    // version for the label and releaseUrl is informational (the
    // actual click goes through openReleasePage so an injected
    // payload can't redirect the user).
    updateAvailable: 'updater:update-available',
    // Main → renderer broadcast: electron-updater fired an `error`
    // event. Topbar surfaces this as a toast so a silent background
    // failure (network down, GitHub API hiccup, manifest parse error)
    // doesn't leave the user wondering why the check never resolved.
    updateError: 'updater:update-error',
    // Renderer → main: replay the most recent update-available event
    // if one fired before the renderer's listener was attached. Used
    // by the Topbar on mount.
    getPending: 'updater:get-pending',
    // Renderer → main: force an out-of-cycle update check. Avatar menu
    // entry uses this so the user doesn't have to wait for the 4 h poll.
    checkNow: 'updater:check-now',
  },
  gallery: {
    list: 'gallery:list',
    listInFlight: 'gallery:list-in-flight',
    resolve: 'gallery:resolve',
    clone: 'gallery:clone',
    cancelClone: 'gallery:cancel-clone',
    remove: 'gallery:remove',
    sync: 'gallery:sync',
    push: 'gallery:push',
    unpushedCommits: 'gallery:unpushed-commits',
    status: 'gallery:status',
    cloneProgress: 'gallery:clone-progress',
    undoLastCommit: 'gallery:undo-last-commit',
    migrate: 'gallery:migrate',
    discover: 'gallery:discover',
    migrateProgress: 'gallery:migrate-progress',
    iCloudRoot: 'gallery:icloud-root',
    // Main → renderer broadcast: a gallery's git state changed in a
    // way that probably affects ahead/behind/dirty. Fired after every
    // mutation handler in storage.ts (write/delete) and after pull /
    // push / undo in gallery.ts. The renderer subscribes once per
    // gallery page and re-fetches `gallery.status(id)` on each event,
    // so the Topbar's ↑N badge stays in sync with the on-disk repo
    // without the user needing to manually refresh.
    //
    // Payload includes `repoPath` so a renderer mounted on a
    // different gallery can ignore events for galleries it doesn't
    // own. `repoPath` is what the storage adapter is keyed on, while
    // gallery handlers carry an `id` — both are emitted so
    // subscribers can match either.
    changed: 'gallery:changed',
  },
  storage: {
    getDefaultBranch: 'storage:get-default-branch',
    listDirectory: 'storage:list-directory',
    readFile: 'storage:read-file',
    readFileMetadata: 'storage:read-file-metadata',
    writeFile: 'storage:write-file',
    batchWriteFiles: 'storage:batch-write-files',
    deleteFile: 'storage:delete-file',
    deleteFiles: 'storage:delete-files',
    deleteDirectory: 'storage:delete-directory',
  },
} as const;

export type GalleryCloneArgs = [
  request: {
    owner: string;
    repo: string;
    fullName: string;
    htmlUrl: string;
    cloneUrl: string;
    defaultBranch?: string;
  },
];

export type GalleryMigrateArgs = [id: string, direction: MigrateDirection];

// Wire format for FileContent. The renderer-side adapter rehydrates this into
// a FileContent (with `text()` / `base64()` helpers) — those methods can't
// cross the IPC boundary.
export type WireFileContent = {
  data: Uint8Array;
  sha: string;
};

export type StorageReadFileArgs = [
  repoPath: string,
  path: string,
  options?: BranchOptions,
];
export type StorageReadFileMetadataArgs = [
  repoPath: string,
  path: string,
  options?: BranchOptions,
];
export type StorageListDirectoryArgs = [
  repoPath: string,
  path: string,
  options?: BranchOptions,
];
export type StorageWriteFileArgs = [
  repoPath: string,
  path: string,
  content: WriteContent,
  message: string,
  options?: WriteOptions,
];
export type StorageBatchWriteFilesArgs = [
  repoPath: string,
  files: BatchFile[],
  message: string,
  options?: BranchOptions,
];
export type StorageDeleteFileArgs = [
  repoPath: string,
  path: string,
  message: string,
  options?: BranchOptions,
];
export type StorageDeleteFilesArgs = [
  repoPath: string,
  paths: string[],
  message: string,
  options?: BranchOptions,
];
export type StorageDeleteDirectoryArgs = [
  repoPath: string,
  dirPath: string,
  message: string,
  options?: BranchOptions,
];

export type GalleryStatus = {
  current: string;
  ahead: number;
  behind: number;
  dirty: boolean;
};

// One entry returned by gallery.unpushedCommits — the subject is the
// already-human-readable message every storage adapter call site
// supplies (e.g. "Add 5 photos to landscape", "Reorder albums"); the
// renderer renders subjects as a hover tooltip on the push button so
// the user knows exactly what the next push will ship.
export type UnpushedCommit = {
  sha: string;
  subject: string;
  author: { name: string; email: string };
};

// Payload of CHANNELS.gallery.changed. Either field may be absent
// depending on which handler fired the event:
//   * storage.ts mutation handlers know the repoPath only
//   * gallery.ts (push/sync/undo) knows both the gallery id and the
//     repoPath via the resolved gallery
// Subscribers should match on whichever field is relevant to them.
export type GalleryChangedEvent = {
  galleryId?: string;
  repoPath?: string;
  // Cause of the change — purely informational, may be used for
  // logging or to skip refetch in cases where it's a no-op (e.g. a
  // pull that resulted in no commits). All known senders set this.
  cause:
    | 'write'
    | 'batch-write'
    | 'delete'
    | 'delete-many'
    | 'delete-dir'
    | 'pull'
    | 'push'
    | 'undo';
};

// Returned by gallery.undoLastCommit. `reverted` is the subject line of
// the commit we just rolled back, useful for the toast that confirms it.
// `refused` means we declined to undo because the commit was already
// pushed — undoing then would force-push, which we never do without
// explicit consent.
export type UndoResult =
  | { ok: true; reverted: string }
  | { ok: false; refused: 'already-pushed' | 'no-prior-commit' | 'dirty' };

// Returned by gallery.push. Surfaces what just got sent so the
// renderer can show a transparent "post-push receipt" — the user
// sees which identity went on the squash commit, what subjects got
// collapsed, and the exact SHA on origin.
//
// Why this exists: the desktop wraps git in two non-obvious ways
// (commit identity is OAuth-derived, not from ~/.gitconfig; and N
// granular ops get squashed into 1 push commit). Both are invisible
// without a receipt, and the latter rewrites local history at push
// time — so giving the user a passive after-action summary is the
// least-friction way to keep them informed without a confirmation
// modal on every push.
export type PushReceipt = {
  // Author embedded in the squash commit (and any new commits
  // authored on this run). `source` lets the UI explain why this
  // identity is shown (OAuth-fetched vs. fallback because GitHub was
  // unreachable).
  identity: {
    name: string;
    email: string;
    source: 'oauth' | 'fallback';
  };
  // Where the push went. `remoteUrl` is the de-tokenized origin URL
  // (never includes the token); the renderer can build a
  // github.com/<full>/commit/<pushedSha> link from `pushedSha` +
  // `fullName` if it wants.
  target: {
    fullName: string;
    branch: string;
    remoteUrl: string;
  };
  pushedSha: string;
  // Non-null when 2+ commits were ahead of origin and got collapsed
  // into one push commit. `collapsed` is the subject lines of those
  // commits, in chronological order. null means a 0- or 1-commit
  // push (squash is a no-op below 2).
  squash: {
    collapsed: string[];
  } | null;
  // Distinct authors among the un-pushed commits BEFORE squashing.
  // Almost always 1 entry (the OAuth identity). 2+ when the user
  // signed in mid-session: prior commits had whatever ~/.gitconfig
  // user.name/email said, new commits use the OAuth identity, and
  // the receipt highlights this transition so attribution doesn't
  // surprise the user.
  authors: Array<{ name: string; email: string }>;
};

// Sent by main when picg://oauth/#... is dispatched to the app, after
// extracting the fragment params. The renderer is responsible for
// validating `state` against whatever it stored in sessionStorage when
// it kicked off the flow.
export type OAuthCallbackPayload =
  | { ok: true; token: string; scope: string; state: string }
  | { ok: false; error: string; state: string };

export type CompressImageRequest = {
  bytes: Uint8Array;
  originalName: string;
  outputFormat: 'webp' | 'jpeg';
  preserveExif: boolean;
  // When true: WebP lossless encode, no 50 MP resize cap. JPEG ignores
  // this flag (JPEG has no lossless mode). Set from the renderer's
  // CompressionSettings.lossless.
  lossless?: boolean;
  // Encoder quality, 0–100. Applies to WebP lossy + JPEG. Ignored when
  // lossless. Omitted = main-side default (75).
  quality?: number;
  // WebP encoder effort, 0–6. Omitted = main-side default (6). JPEG
  // ignores this.
  webpEffort?: number;
  // Soft pixel cap in megapixels. null = no cap (equivalent to the
  // lossless behaviour for cap purposes). Omitted = main-side default
  // (50 MP).
  maxMegapixels?: number | null;
};

export type CompressImageResult = {
  buffer: Uint8Array;
  name: string;
  type: string;
};

export interface PicgBridge {
  pickGalleryDir(): Promise<string | null>;
  auth: {
    openExternal(url: string): Promise<void>;
    onOAuthCallback(handler: (payload: OAuthCallbackPayload) => void): () => void;
    saveToken(token: string): Promise<void>;
    getToken(): Promise<string | null>;
    clearToken(): Promise<void>;
  };
  compress: {
    image(request: CompressImageRequest): Promise<CompressImageResult>;
  };
  updater: {
    openReleasePage(): Promise<void>;
    onUpdateAvailable(
      handler: (info: { version: string; releaseUrl: string }) => void
    ): () => void;
    onUpdateError(handler: (info: { message: string }) => void): () => void;
    getPending(): Promise<{ version: string; releaseUrl: string } | null>;
    checkNow(): Promise<
      | {
          ok: true;
          currentVersion: string;
          manifestVersion: string | null;
          updateAvailable: boolean;
          available: { version: string; releaseUrl: string } | null;
          releaseUrl: string;
          // Most recent updater error captured in this session, if
          // any. Lets the manual-check toast surface "last attempt
          // failed because X" instead of leaving the user guessing.
          lastError: { message: string; at: string } | null;
        }
      | { ok: false; error: string }
    >;
  };
  gallery: {
    list(): Promise<LocalGallery[]>;
    listInFlight(): Promise<InFlightClone[]>;
    resolve(id: string): Promise<LocalGallery | null>;
    clone(...args: GalleryCloneArgs): Promise<LocalGallery>;
    // Cancel an in-flight clone by gallery id. Idempotent. The pending
    // clone() promise rejects with CLONE_CANCELLED_MESSAGE; the renderer
    // matches on that string to dismiss the card without an error.
    cancelClone(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    sync(id: string): Promise<LocalGallery>;
    push(id: string): Promise<PushReceipt>;
    unpushedCommits(id: string): Promise<UnpushedCommit[]>;
    status(id: string): Promise<GalleryStatus>;
    undoLastCommit(id: string): Promise<UndoResult>;
    onCloneProgress(handler: (event: CloneProgress) => void): () => void;
    migrate(...args: GalleryMigrateArgs): Promise<LocalGallery>;
    discover(): Promise<LocalGallery[]>;
    iCloudRoot(): Promise<string>;
    onMigrateProgress(handler: (event: MigrateProgress) => void): () => void;
    // Subscribe to git-state-change broadcasts. See CHANNELS.gallery.changed.
    onChanged(handler: (event: GalleryChangedEvent) => void): () => void;
  };
  storage: {
    getDefaultBranch(repoPath: string): Promise<string>;
    listDirectory(...args: StorageListDirectoryArgs): Promise<DirectoryEntry[]>;
    readFile(...args: StorageReadFileArgs): Promise<WireFileContent>;
    readFileMetadata(
      ...args: StorageReadFileMetadataArgs
    ): Promise<FileMetadata | null>;
    writeFile(...args: StorageWriteFileArgs): Promise<void>;
    batchWriteFiles(...args: StorageBatchWriteFilesArgs): Promise<void>;
    deleteFile(...args: StorageDeleteFileArgs): Promise<void>;
    deleteFiles(...args: StorageDeleteFilesArgs): Promise<void>;
    deleteDirectory(...args: StorageDeleteDirectoryArgs): Promise<void>;
  };
}
