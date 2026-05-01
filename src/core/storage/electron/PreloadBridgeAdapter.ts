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

// Detect whether the renderer is running inside Electron (has the preload
// bridge mounted). UI code that wants to swap adapters can use this gate.
export function getPicgBridge():
  | { pickGalleryDir(): Promise<string | null>; storage: PreloadStorageBridge }
  | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    picgBridge?: { pickGalleryDir(): Promise<string | null>; storage: PreloadStorageBridge };
  };
  return w.picgBridge ?? null;
}
