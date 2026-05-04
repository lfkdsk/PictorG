import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SimpleGit } from 'simple-git';

import { buildIsolatedGit } from '../galleries/isolatedGit';
import { getStoredToken } from '../ipc/auth';
import type { StorageAdapter } from '../../src/core/storage/StorageAdapter';
import type {
  BatchFile,
  BranchOptions,
  DirectoryEntry,
  FileContent,
  FileMetadata,
  WriteContent,
  WriteOptions,
} from '../../src/core/storage/types';
import {
  bytesToBase64,
  bytesToUtf8,
  utf8ToBytes,
} from '../../src/core/storage/encoding';

export type LocalGitStorageAdapterConfig = {
  repoPath: string;
  // If true, run `git push` after every commit (matching the GitHub adapter's
  // "every write hits the remote" behavior). The desktop UX may eventually
  // want to defer pushing — flag stays here so callers can opt out.
  autoPush?: boolean;
};

function toBytes(content: WriteContent): Uint8Array {
  return typeof content === 'string' ? utf8ToBytes(content) : content;
}

// StorageAdapter implementation backed by a local git working tree. Writes
// stage the file, commit, and (by default) push. Reads come straight from the
// working tree — branch options are accepted for interface parity but ignored
// here, since we always operate on whatever's currently checked out.
export class LocalGitStorageAdapter implements StorageAdapter {
  readonly id: string;
  private readonly repoPath: string;
  // SimpleGit instance, built lazily with the isolated env + config
  // so child `git` processes ignore ~/.gitconfig, /etc/gitconfig, the
  // user's SSH keys, and any credential helpers. See
  // electron/galleries/isolatedGit.ts for what's neutralized and why.
  //
  // Stored as a Promise so the constructor stays sync — the first
  // method call awaits it; subsequent calls re-use the resolved value.
  // forCommits: true because every write path here ends in `git commit`.
  private readonly git: Promise<SimpleGit>;
  private readonly autoPush: boolean;

  constructor(config: LocalGitStorageAdapterConfig) {
    this.repoPath = path.resolve(config.repoPath);
    this.id = this.repoPath;
    this.git = buildIsolatedGit(this.repoPath, { forCommits: true });
    this.autoPush = config.autoPush ?? true;
  }

  // --- branch ---

  async getDefaultBranch(): Promise<string> {
    try {
      const git = await this.git;
      const head = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
      if (head) return head;
    } catch {
      /* fall through */
    }
    return 'main';
  }

  // --- read ---

  async listDirectory(
    relPath: string,
    _options?: BranchOptions
  ): Promise<DirectoryEntry[]> {
    const absDir = this.absolute(relPath);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    const out: DirectoryEntry[] = [];
    for (const entry of entries) {
      // Skip the .git directory and other hidden git-internal artifacts to
      // mirror what the GitHub adapter would surface.
      if (entry.name === '.git') continue;

      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const sha = await this.tryFileSha(childRel);
      const stat = await fs.stat(this.absolute(childRel)).catch(() => null);

      out.push({
        name: entry.name,
        path: childRel,
        type: entry.isDirectory() ? 'dir' : 'file',
        sha: sha ?? '',
        size: stat?.size,
      });
    }
    return out;
  }

  async readFile(relPath: string, _options?: BranchOptions): Promise<FileContent> {
    const buf = await fs.readFile(this.absolute(relPath));
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const sha = (await this.tryFileSha(relPath)) ?? '';
    return {
      data,
      sha,
      text: () => bytesToUtf8(data),
      base64: () => bytesToBase64(data),
    };
  }

  async readFileMetadata(
    relPath: string,
    _options?: BranchOptions
  ): Promise<FileMetadata | null> {
    const abs = this.absolute(relPath);
    try {
      const stat = await fs.stat(abs);
      const sha = (await this.tryFileSha(relPath)) ?? '';
      return { sha, size: stat.size };
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // --- write ---

  async writeFile(
    relPath: string,
    content: WriteContent,
    message: string,
    _options?: WriteOptions
  ): Promise<void> {
    await this.writeFileToDisk(relPath, content);
    const git = await this.git;
    await git.add([relPath]);
    await git.commit(message);
    await this.maybePush();
  }

  async batchWriteFiles(
    files: BatchFile[],
    message: string,
    _options?: BranchOptions
  ): Promise<void> {
    if (files.length === 0) return;
    for (const file of files) {
      await this.writeFileToDisk(file.path, file.content);
    }
    const git = await this.git;
    await git.add(files.map((f) => f.path));
    await git.commit(message);
    await this.maybePush();
  }

  // --- delete ---

  async deleteFile(
    relPath: string,
    message: string,
    _options?: BranchOptions
  ): Promise<void> {
    return this.deleteFiles([relPath], message);
  }

  async deleteFiles(
    relPaths: string[],
    message: string,
    _options?: BranchOptions
  ): Promise<void> {
    const unique = Array.from(new Set(relPaths.map((p) => p.trim()).filter(Boolean)));
    if (unique.length === 0) {
      throw new Error('没有可删除的文件');
    }
    const git = await this.git;
    await git.rm(unique);
    await git.commit(message);
    await this.maybePush();
  }

  async deleteDirectory(
    relDir: string,
    message: string,
    _options?: BranchOptions
  ): Promise<void> {
    const absDir = this.absolute(relDir);
    try {
      const stat = await fs.stat(absDir);
      if (!stat.isDirectory()) {
        throw new Error('目录路径指向的不是一个目录');
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new Error('目录不存在');
      throw err;
    }

    const git = await this.git;
    // `git rm -r` handles tracked files; untracked files inside aren't tracked
    // so we drop them with fs.rm afterwards. Order matters — git first so it
    // doesn't complain about missing paths.
    await git.rm(['-r', relDir]);
    await fs.rm(absDir, { recursive: true, force: true });
    await git.commit(message);
    await this.maybePush();
  }

  // --- internals ---

  private absolute(relPath: string): string {
    // Reject parent-directory escapes — same threat model as the GitHub side
    // where the API path is server-resolved.
    const normalized = path.normalize(relPath);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Invalid path outside repo: ${relPath}`);
    }
    return path.join(this.repoPath, normalized);
  }

  private async writeFileToDisk(relPath: string, content: WriteContent): Promise<void> {
    const abs = this.absolute(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, toBytes(content));
  }

  private async tryFileSha(relPath: string): Promise<string | undefined> {
    try {
      const git = await this.git;
      const sha = (await git.raw(['rev-parse', `HEAD:${relPath}`])).trim();
      return sha || undefined;
    } catch {
      return undefined;
    }
  }

  private async maybePush(): Promise<void> {
    if (!this.autoPush) return;
    try {
      const git = await this.git;
      // Same approach as GalleryRegistry.push(): push to the tokenized
      // URL POSITIONALLY (not via `-c remote.origin.url=`, which git
      // silently strips credentials from), then update the tracking
      // ref locally. Kept narrowly here because this autoPush path
      // is dev-only (PICG_AUTOPUSH=1) and the primary publish flow
      // goes through GalleryRegistry.
      const token = getStoredToken();
      if (!token) {
        throw new Error(
          'Not signed in — open Pictor and complete GitHub sign-in before auto-pushing.'
        );
      }
      const originUrl = (await git.remote(['get-url', 'origin']))?.toString().trim() ?? '';
      if (!originUrl.startsWith('https://')) {
        throw new Error(`Unsupported origin URL for tokenized push: ${originUrl || '<empty>'}`);
      }
      const tokenizedUrl = originUrl.replace(
        'https://',
        `https://oauth2:${encodeURIComponent(token)}@`
      );
      const branchInfo = await git.branch();
      const branch = branchInfo.current || 'HEAD';
      await git.raw(['push', tokenizedUrl, `HEAD:${branch}`]);
      await git
        .raw(['update-ref', `refs/remotes/origin/${branch}`, 'HEAD'])
        .catch(() => {
          /* non-fatal — see GalleryRegistry.push() comment */
        });
    } catch (err) {
      // Surface push failures without rolling back the commit — same shape as
      // GitHub adapter errors. Caller decides whether to retry.
      throw new Error(
        `Local commit succeeded but push failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
