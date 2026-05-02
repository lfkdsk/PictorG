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
  compress: {
    image: 'compress:image',
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
    token: string;
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

export interface PicgBridge {
  pickGalleryDir(): Promise<string | null>;
  compress: {
    image(request: CompressImageRequest): Promise<CompressImageResult>;
  };
  gallery: {
    list(): Promise<LocalGallery[]>;
    resolve(id: string): Promise<LocalGallery | null>;
    clone(...args: GalleryCloneArgs): Promise<LocalGallery>;
    remove(id: string): Promise<void>;
    sync(id: string): Promise<LocalGallery>;
    push(id: string): Promise<void>;
    status(id: string): Promise<GalleryStatus>;
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
