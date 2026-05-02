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
import type { CloneProgress, LocalGallery } from '../../src/core/storage/electron/galleryTypes';

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
    // Renderer → main: quit the app and install the downloaded update
    // immediately. Triggered by the Topbar "Update ready" button.
    installNow: 'updater:install-now',
    // Main → renderer broadcast: a new version finished downloading
    // and will install on next quit (or now via installNow).
    updateDownloaded: 'updater:update-downloaded',
    // Renderer → main: replay the most recent update-downloaded event
    // if one fired before the renderer's listener was attached. Used
    // by the Topbar on mount.
    getPending: 'updater:get-pending',
    // Renderer → main: force an out-of-cycle update check. Avatar menu
    // entry uses this so the user doesn't have to wait for the 4 h poll.
    checkNow: 'updater:check-now',
  },
  gallery: {
    list: 'gallery:list',
    resolve: 'gallery:resolve',
    clone: 'gallery:clone',
    remove: 'gallery:remove',
    sync: 'gallery:sync',
    push: 'gallery:push',
    status: 'gallery:status',
    cloneProgress: 'gallery:clone-progress',
    undoLastCommit: 'gallery:undo-last-commit',
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

// Returned by gallery.undoLastCommit. `reverted` is the subject line of
// the commit we just rolled back, useful for the toast that confirms it.
// `refused` means we declined to undo because the commit was already
// pushed — undoing then would force-push, which we never do without
// explicit consent.
export type UndoResult =
  | { ok: true; reverted: string }
  | { ok: false; refused: 'already-pushed' | 'no-prior-commit' | 'dirty' };

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
    installNow(): Promise<void>;
    onUpdateDownloaded(handler: (info: { version?: string }) => void): () => void;
    getPending(): Promise<{ version?: string } | null>;
    checkNow(): Promise<
      | {
          ok: true;
          currentVersion: string;
          manifestVersion: string | null;
          updateAvailable: boolean;
          downloaded: { version?: string } | null;
        }
      | { ok: false; error: string }
    >;
  };
  gallery: {
    list(): Promise<LocalGallery[]>;
    resolve(id: string): Promise<LocalGallery | null>;
    clone(...args: GalleryCloneArgs): Promise<LocalGallery>;
    remove(id: string): Promise<void>;
    sync(id: string): Promise<LocalGallery>;
    push(id: string): Promise<void>;
    status(id: string): Promise<GalleryStatus>;
    undoLastCommit(id: string): Promise<UndoResult>;
    onCloneProgress(handler: (event: CloneProgress) => void): () => void;
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
