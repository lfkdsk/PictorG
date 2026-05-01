import type {
  BatchFile,
  BranchOptions,
  DirectoryEntry,
  FileContent,
  FileMetadata,
  WriteContent,
  WriteOptions,
} from './types';

// Per-gallery storage abstraction. Web implementation hits the GitHub Contents
// + Git Data APIs; the planned desktop implementation will operate on a local
// git working tree (fs + simple-git or equivalent).
//
// Design notes:
// - Stateful: each adapter instance is bound to a single gallery (owner/repo
//   on web, a local repo path on desktop). Top-level operations like
//   "list user repos" or "create repo" are GitHub-specific and live on
//   GitHubStorageAdapter as additional methods, not on this interface.
// - Content is `Uint8Array | string`. Strings are treated as utf-8 text;
//   adapters base64-encode at the boundary as required by their backend.
// - All `branch` parameters default to the repo's default branch.
export interface StorageAdapter {
  // The gallery this adapter is bound to. Web exposes `${owner}/${repo}`;
  // desktop will expose the local path.
  readonly id: string;

  // Resolves the default branch name. On web this hits the GitHub API once
  // and is cached by callers as needed; on desktop it reads the local HEAD ref.
  getDefaultBranch(): Promise<string>;

  listDirectory(path: string, options?: BranchOptions): Promise<DirectoryEntry[]>;

  readFile(path: string, options?: BranchOptions): Promise<FileContent>;

  // Returns null if the file does not exist (does not throw).
  readFileMetadata(path: string, options?: BranchOptions): Promise<FileMetadata | null>;

  // Writes a single file in one commit. If `options.sha` is provided, the
  // backend treats this as an update; otherwise as create-or-replace.
  writeFile(
    path: string,
    content: WriteContent,
    message: string,
    options?: WriteOptions
  ): Promise<void>;

  // Writes many files atomically (single commit). Adapters that don't support
  // atomic batching MUST simulate it (e.g., desktop git stages all then
  // commits once); never silently fall back to per-file commits.
  batchWriteFiles(
    files: BatchFile[],
    message: string,
    options?: BranchOptions
  ): Promise<void>;

  deleteFile(path: string, message: string, options?: BranchOptions): Promise<void>;

  deleteFiles(paths: string[], message: string, options?: BranchOptions): Promise<void>;

  deleteDirectory(
    dirPath: string,
    message: string,
    options?: BranchOptions
  ): Promise<void>;
}
