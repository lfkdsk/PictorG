// Cross-platform storage types. Shared by web (GitHub API) and future desktop
// (local fs + git) adapters.

// Mirrors the GitHub `repo` payload shape so existing call sites keep compiling.
// Desktop will need to either synthesize this from a local repo or expose a
// different "gallery descriptor" — that's a follow-up.
export type Repo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
};

export type DirectoryEntryType = 'file' | 'dir';

export type DirectoryEntry = {
  name: string;
  path: string;
  type: DirectoryEntryType;
  sha: string;
  size?: number;
};

export type FileMetadata = {
  sha: string;
  size?: number;
};

// Read result. `data` is the raw bytes; helpers cover the two encodings the
// existing code uses (utf-8 text, base64 string).
export type FileContent = {
  data: Uint8Array;
  sha: string;
  text(): string;
  base64(): string;
};

// Content for writes. `string` is treated as utf-8 text; `Uint8Array` is raw
// bytes. Adapters base64-encode internally as needed.
export type WriteContent = string | Uint8Array;

export type BatchFile = {
  path: string;
  content: WriteContent;
};

export type WriteOptions = {
  sha?: string;     // required by GitHub Contents API for updates
  branch?: string;  // defaults to the repo's default branch
};

export type BranchOptions = {
  branch?: string;
};
