import type { StorageAdapter } from '../StorageAdapter';
import type {
  BatchFile,
  BranchOptions,
  DirectoryEntry,
  FileContent,
  FileMetadata,
  WriteContent,
  WriteOptions,
} from '../types';
import { bytesToBase64, bytesToUtf8 } from '../encoding';
import type {
  CloneProgress,
  InFlightClone,
  LocalGallery,
  PhotoIndexProgress,
  PhotoIndexResult,
} from './galleryTypes';

// Renderer-side adapter that forwards every StorageAdapter call to the
// Electron preload bridge. Used in the desktop app; on web the import is
// dead-code-eliminated as long as code paths keep `isElectron()` gated.
//
// The preload bridge contract is duplicated here as a structural type so
// renderer code doesn't need to import from `electron/`. The shape MUST stay
// in sync with electron/ipc/contract.ts.

export type PreloadStorageBridge = {
  getDefaultBranch(repoPath: string): Promise<string>;
  listDirectory(
    repoPath: string,
    path: string,
    options?: BranchOptions
  ): Promise<DirectoryEntry[]>;
  readFile(
    repoPath: string,
    path: string,
    options?: BranchOptions
  ): Promise<{ data: Uint8Array; sha: string }>;
  readFileMetadata(
    repoPath: string,
    path: string,
    options?: BranchOptions
  ): Promise<FileMetadata | null>;
  writeFile(
    repoPath: string,
    path: string,
    content: WriteContent,
    message: string,
    options?: WriteOptions
  ): Promise<void>;
  batchWriteFiles(
    repoPath: string,
    files: BatchFile[],
    message: string,
    options?: BranchOptions
  ): Promise<void>;
  deleteFile(
    repoPath: string,
    path: string,
    message: string,
    options?: BranchOptions
  ): Promise<void>;
  deleteFiles(
    repoPath: string,
    paths: string[],
    message: string,
    options?: BranchOptions
  ): Promise<void>;
  deleteDirectory(
    repoPath: string,
    dirPath: string,
    message: string,
    options?: BranchOptions
  ): Promise<void>;
};

export type PreloadBridgeAdapterConfig = {
  repoPath: string;
  bridge: PreloadStorageBridge;
};

export class PreloadBridgeAdapter implements StorageAdapter {
  readonly id: string;
  private readonly repoPath: string;
  private readonly bridge: PreloadStorageBridge;

  constructor(config: PreloadBridgeAdapterConfig) {
    this.repoPath = config.repoPath;
    this.bridge = config.bridge;
    this.id = config.repoPath;
  }

  getDefaultBranch(): Promise<string> {
    return this.bridge.getDefaultBranch(this.repoPath);
  }

  listDirectory(path: string, options?: BranchOptions): Promise<DirectoryEntry[]> {
    return this.bridge.listDirectory(this.repoPath, path, options);
  }

  async readFile(path: string, options?: BranchOptions): Promise<FileContent> {
    const wire = await this.bridge.readFile(this.repoPath, path, options);
    // Electron IPC structured-clones Uint8Array fine; reconstruct helpers here.
    const data = wire.data instanceof Uint8Array ? wire.data : new Uint8Array(wire.data);
    return {
      data,
      sha: wire.sha,
      text: () => bytesToUtf8(data),
      base64: () => bytesToBase64(data),
    };
  }

  readFileMetadata(
    path: string,
    options?: BranchOptions
  ): Promise<FileMetadata | null> {
    return this.bridge.readFileMetadata(this.repoPath, path, options);
  }

  writeFile(
    path: string,
    content: WriteContent,
    message: string,
    options?: WriteOptions
  ): Promise<void> {
    return this.bridge.writeFile(this.repoPath, path, content, message, options);
  }

  batchWriteFiles(
    files: BatchFile[],
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    return this.bridge.batchWriteFiles(this.repoPath, files, message, options);
  }

  deleteFile(
    path: string,
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    return this.bridge.deleteFile(this.repoPath, path, message, options);
  }

  deleteFiles(
    paths: string[],
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    return this.bridge.deleteFiles(this.repoPath, paths, message, options);
  }

  deleteDirectory(
    dirPath: string,
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    return this.bridge.deleteDirectory(this.repoPath, dirPath, message, options);
  }
}

export type GalleryStatus = {
  current: string;
  ahead: number;
  behind: number;
  dirty: boolean;
};

// Mirror of UnpushedCommit in electron/ipc/contract.ts. Same sync
// rule — keep in lockstep with the main-side definition.
export type UnpushedCommit = {
  sha: string;
  subject: string;
  author: { name: string; email: string };
};

export type CompressImageRequest = {
  bytes: Uint8Array;
  originalName: string;
  outputFormat: 'webp' | 'jpeg' | 'ultrahdr';
  preserveExif: boolean;
  lossless?: boolean;
  quality?: number;
  webpEffort?: number;
  maxMegapixels?: number | null;
};

export type CompressImageResult = {
  buffer: Uint8Array;
  name: string;
  type: string;
};

// Display-only transcode (HEIC → small JPEG via sips in main). Mirrors
// CompressPreviewRequest/Result in electron/ipc/contract.ts; kept here so
// renderer code doesn't import from electron/.
export type CompressPreviewRequest = {
  bytes: Uint8Array;
  originalName: string;
  maxEdge?: number;
};

export type CompressPreviewResult = {
  buffer: Uint8Array;
  type: string;
};

export type PreloadCompressBridge = {
  image(request: CompressImageRequest): Promise<CompressImageResult>;
  preview(request: CompressPreviewRequest): Promise<CompressPreviewResult>;
};

export type OAuthCallbackPayload =
  | { ok: true; token: string; scope: string; state: string }
  | { ok: false; error: string; state: string };

export type PreloadAuthBridge = {
  openExternal(url: string): Promise<void>;
  onOAuthCallback(handler: (payload: OAuthCallbackPayload) => void): () => void;
  saveToken(token: string): Promise<void>;
  getToken(): Promise<string | null>;
  clearToken(): Promise<void>;
};

// Bridge surface for the App-managed gallery library. The actual
// implementation lives in main (electron/galleries/GalleryRegistry.ts) and
// is exposed through preload.ts via contextBridge.
// Result shape for gallery.undoLastCommit. Mirrors UndoResult in the
// electron contract but defined here so renderer code doesn't need to
// import from electron/.
export type UndoResult =
  | { ok: true; reverted: string }
  | { ok: false; refused: 'already-pushed' | 'no-prior-commit' | 'dirty' };

// Marker thrown across IPC when an in-flight clone is cancelled by the
// user via cancelClone(). Renderer matches on this string to dismiss the
// card silently rather than surface an error banner.
export const CLONE_CANCELLED_MESSAGE = 'PICG_CLONE_CANCELLED';

export type PreloadGalleryBridge = {
  list(): Promise<LocalGallery[]>;
  // Snapshot of clones currently running in main. Used by the
  // galleries page on mount to rebuild progress UI when the user
  // navigated away and came back mid-clone.
  listInFlight(): Promise<InFlightClone[]>;
  resolve(id: string): Promise<LocalGallery | null>;
  clone(request: {
    owner: string;
    repo: string;
    fullName: string;
    htmlUrl: string;
    cloneUrl: string;
    defaultBranch?: string;
  }): Promise<LocalGallery>;
  // Cancel an in-flight clone. Idempotent. The pending clone() promise
  // rejects with CLONE_CANCELLED_MESSAGE so the caller can distinguish
  // a cancellation from a real failure.
  cancelClone(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  // Reveal the gallery's on-disk folder in the OS file manager. Resolves
  // to '' on success or the OS error string on failure (shell.openPath
  // contract). Backed by gallery:open-folder in main.
  openFolder(id: string): Promise<string>;
  sync(id: string): Promise<LocalGallery>;
  push(id: string): Promise<PushReceipt>;
  // Subjects of the commits sitting between origin/<branch> and
  // HEAD, oldest-first. Empty when there's no upstream or nothing
  // ahead. Backed by `git log origin/<branch>..HEAD` in main; the
  // tooltip on the push button reads this on hover.
  unpushedCommits(id: string): Promise<UnpushedCommit[]>;
  status(id: string): Promise<GalleryStatus>;
  // Fetches the current branch from remote, then returns local
  // ahead/behind status. Intended for page entry; status() stays
  // local-only for cheap refreshes after gallery.changed broadcasts.
  refreshStatus(id: string): Promise<GalleryStatus>;
  undoLastCommit(id: string): Promise<UndoResult>;
  // Subscribe to clone-progress events. Returns an unsubscribe fn — call it
  // from a useEffect cleanup to avoid leaks.
  onCloneProgress(handler: (event: CloneProgress) => void): () => void;
  // Subscribe to git-state-change broadcasts. Main fires these
  // after every storage mutation (write/delete/etc.) and after
  // pull/push/undo. Lets the renderer keep its ahead/behind/dirty
  // state live without remembering to refetch at every mutation
  // call site. Returns an unsubscribe fn.
  onChanged(handler: (event: GalleryChangedEvent) => void): () => void;
};

// Mirror of GalleryChangedEvent in electron/ipc/contract.ts. Kept
// duplicated rather than imported because renderer code can't reach
// across the electron/ boundary; the shape MUST stay in sync.
export type GalleryChangedEvent = {
  galleryId?: string;
  repoPath?: string;
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

// Mirror of PushReceipt in electron/ipc/contract.ts. Same sync rule —
// keep this in lockstep with the main-side definition.
export type PushReceipt = {
  identity: {
    name: string;
    email: string;
    source: 'oauth' | 'fallback';
  };
  target: {
    fullName: string;
    branch: string;
    remoteUrl: string;
  };
  pushedSha: string;
  squash: { collapsed: string[] } | null;
  authors: Array<{ name: string; email: string }>;
};

export type PreloadUpdaterBridge = {
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
        lastError: { message: string; at: string } | null;
      }
    | { ok: false; error: string }
  >;
};

// Bridge surface for the desktop-local photo index. Implemented in main
// (electron/photoIndex/) and exposed through preload.ts. The shape MUST
// stay in sync with electron/ipc/contract.ts.
export type PreloadPhotoIndexBridge = {
  // Returns the cached on-disk sqlite.db bytes when nothing changed, else the
  // rows to rebuild from (+ the fingerprint to echo back via saveDb). First
  // build of a large gallery is slow; subscribe via onProgress for a bar.
  build(galleryId: string): Promise<PhotoIndexResult>;
  // Persist the renderer-built sqlite.db bytes to disk under the given
  // fingerprint; resolves to the absolute path written.
  saveDb(
    galleryId: string,
    bytes: Uint8Array,
    fingerprint: string
  ): Promise<string>;
  // Drop the cached db-meta so the next build rebuilds — called when the
  // renderer can't open the cached db bytes.
  invalidate(galleryId: string): Promise<void>;
  // Subscribe to extraction progress. Returns an unsubscribe fn.
  onProgress(handler: (progress: PhotoIndexProgress) => void): () => void;
};

export type PicgBridge = {
  pickGalleryDir(): Promise<string | null>;
  auth: PreloadAuthBridge;
  compress: PreloadCompressBridge;
  updater?: PreloadUpdaterBridge;
  gallery: PreloadGalleryBridge;
  storage: PreloadStorageBridge;
  photoIndex: PreloadPhotoIndexBridge;
};

// Detect whether the renderer is running inside Electron (has the preload
// bridge mounted). UI code that wants to swap adapters can use this gate.
export function getPicgBridge(): PicgBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { picgBridge?: PicgBridge };
  return w.picgBridge ?? null;
}
