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
import type { CloneProgress, LocalGallery } from './galleryTypes';

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
};

// Bridge surface for the App-managed gallery library. The actual
// implementation lives in main (electron/galleries/GalleryRegistry.ts) and
// is exposed through preload.ts via contextBridge.
export type PreloadGalleryBridge = {
  list(): Promise<LocalGallery[]>;
  resolve(id: string): Promise<LocalGallery | null>;
  clone(request: {
    owner: string;
    repo: string;
    fullName: string;
    htmlUrl: string;
    cloneUrl: string;
    defaultBranch?: string;
    token: string;
  }): Promise<LocalGallery>;
  remove(id: string): Promise<void>;
  sync(id: string): Promise<LocalGallery>;
  push(id: string): Promise<void>;
  status(id: string): Promise<GalleryStatus>;
  // Subscribe to clone-progress events. Returns an unsubscribe fn — call it
  // from a useEffect cleanup to avoid leaks.
  onCloneProgress(handler: (event: CloneProgress) => void): () => void;
};

export type PicgBridge = {
  pickGalleryDir(): Promise<string | null>;
  auth: PreloadAuthBridge;
  compress: PreloadCompressBridge;
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
