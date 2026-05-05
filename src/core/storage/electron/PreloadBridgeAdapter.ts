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
  MigrateDirection,
  MigrateProgress,
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

export type CompressImageRequest = {
  bytes: Uint8Array;
  originalName: string;
  outputFormat: 'webp' | 'jpeg';
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

export type PreloadCompressBridge = {
  image(request: CompressImageRequest): Promise<CompressImageResult>;
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
  sync(id: string): Promise<LocalGallery>;
  push(id: string): Promise<PushReceipt>;
  status(id: string): Promise<GalleryStatus>;
  undoLastCommit(id: string): Promise<UndoResult>;
  // Subscribe to clone-progress events. Returns an unsubscribe fn — call it
  // from a useEffect cleanup to avoid leaks.
  onCloneProgress(handler: (event: CloneProgress) => void): () => void;
  // Move a gallery between the app's userData and iCloud Drive. The
  // promise resolves once the swap is complete (manifest updated,
  // source removed); the returned LocalGallery has the new path and
  // updated `storage` field.
  migrate(id: string, direction: MigrateDirection): Promise<LocalGallery>;
  // Scan the iCloud PicG directory for galleries the local manifest
  // doesn't know about and add them. Returns the newly-added entries
  // (decorated with `storage: 'icloud'`); empty array means the scan
  // turned up nothing new. Safe to call repeatedly.
  discover(): Promise<LocalGallery[]>;
  // Absolute path of the iCloud PicG root, e.g.
  // /Users/<you>/Library/Mobile Documents/com~apple~CloudDocs/PicG.
  // The renderer surfaces this in a settings hint so the user can
  // open it in Finder.
  iCloudRoot(): Promise<string>;
  // Subscribe to migrate-progress events. Same shape as
  // onCloneProgress: returns an unsubscribe fn.
  onMigrateProgress(handler: (event: MigrateProgress) => void): () => void;
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
  installNow(): Promise<void>;
  onUpdateDownloaded(
    handler: (info: { version?: string }) => void
  ): () => void;
  onDownloadProgress(
    handler: (info: { percent: number }) => void
  ): () => void;
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

export type PicgBridge = {
  pickGalleryDir(): Promise<string | null>;
  auth: PreloadAuthBridge;
  compress: PreloadCompressBridge;
  updater?: PreloadUpdaterBridge;
  gallery: PreloadGalleryBridge;
  storage: PreloadStorageBridge;
};

// Detect whether the renderer is running inside Electron (has the preload
// bridge mounted). UI code that wants to swap adapters can use this gate.
export function getPicgBridge(): PicgBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { picgBridge?: PicgBridge };
  return w.picgBridge ?? null;
}
