// IPC contract shared between the main process (handlers in ipc/storage.ts)
// and the preload script (window.picgBridge in preload.ts).
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

export const CHANNELS = {
  pickGalleryDir: 'gallery:pick-dir',
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

export interface PicgBridge {
  pickGalleryDir(): Promise<string | null>;
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
