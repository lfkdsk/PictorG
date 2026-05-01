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
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  utf8ToBytes,
} from '../encoding';
import { encodePath } from '../path';
import { GITHUB_API_BASE } from './api';

export type GitHubStorageAdapterConfig = {
  token: string;
  owner: string;
  repo: string;
  // Override the API host for testing; defaults to https://api.github.com.
  apiBase?: string;
};

const ACCEPT = 'application/vnd.github+json';

function toBytes(content: WriteContent): Uint8Array {
  return typeof content === 'string' ? utf8ToBytes(content) : content;
}

// Lifts WriteContent → base64 string for the GitHub Contents/Blobs APIs.
function toBase64(content: WriteContent): string {
  return bytesToBase64(toBytes(content));
}

export class GitHubStorageAdapter implements StorageAdapter {
  readonly id: string;
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly base: string;

  constructor(config: GitHubStorageAdapterConfig) {
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
    this.base = config.apiBase ?? GITHUB_API_BASE;
    this.id = `${this.owner}/${this.repo}`;
  }

  // --- low-level request helpers ---

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      Accept: ACCEPT,
      ...extra,
    };
  }

  private repoUrl(suffix: string): string {
    return `${this.base}/repos/${this.owner}/${this.repo}${suffix}`;
  }

  // --- branch ---

  async getDefaultBranch(): Promise<string> {
    try {
      const res = await fetch(this.repoUrl(''), { headers: this.headers() });
      if (!res.ok) {
        throw new Error(`Failed to get repository info: ${res.statusText}`);
      }
      const data = await res.json();
      return data.default_branch || 'main';
    } catch (error) {
      console.warn('Failed to get default branch, falling back to main:', error);
      return 'main';
    }
  }

  private async resolveBranch(branch?: string): Promise<string> {
    return branch ?? (await this.getDefaultBranch());
  }

  // --- read ---

  async listDirectory(
    path: string,
    options?: BranchOptions
  ): Promise<DirectoryEntry[]> {
    const ref = options?.branch ? `?ref=${encodeURIComponent(options.branch)}` : '';
    const res = await fetch(
      this.repoUrl(`/contents/${encodePath(path)}${ref}`),
      { headers: this.headers() }
    );

    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Failed to get repo contents: ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      // Path resolved to a single file; not a directory.
      return [];
    }
    return data.map((item: any) => ({
      name: item.name,
      path: item.path,
      type: item.type === 'dir' ? 'dir' : 'file',
      sha: item.sha,
      size: item.size,
    }));
  }

  async readFile(path: string, options?: BranchOptions): Promise<FileContent> {
    const ref = options?.branch ? `?ref=${encodeURIComponent(options.branch)}` : '';
    const res = await fetch(
      this.repoUrl(`/contents/${encodePath(path)}${ref}`),
      { headers: this.headers() }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch ${path}: ${res.statusText}`);
    }

    const data = await res.json();
    const bytes = base64ToBytes(data.content.replace(/\n/g, ''));
    return {
      data: bytes,
      sha: data.sha,
      text: () => bytesToUtf8(bytes),
      base64: () => bytesToBase64(bytes),
    };
  }

  async readFileMetadata(
    path: string,
    options?: BranchOptions
  ): Promise<FileMetadata | null> {
    try {
      const ref = options?.branch ? `?ref=${encodeURIComponent(options.branch)}` : '';
      const res = await fetch(
        this.repoUrl(`/contents/${encodePath(path)}${ref}`),
        { headers: this.headers() }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return { sha: data.sha, size: data.size };
    } catch {
      return null;
    }
  }

  // --- write ---

  async writeFile(
    path: string,
    content: WriteContent,
    message: string,
    options?: WriteOptions
  ): Promise<void> {
    const branch = await this.resolveBranch(options?.branch);

    // If sha not given, look it up so the request becomes a safe overwrite.
    let sha = options?.sha;
    if (!sha) {
      const meta = await this.readFileMetadata(path, { branch });
      sha = meta?.sha;
    }

    const body: Record<string, unknown> = {
      message,
      content: toBase64(content),
      branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(this.repoUrl(`/contents/${encodePath(path)}`), {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload file: ${res.status} - ${errorText}`);
    }
  }

  async batchWriteFiles(
    files: BatchFile[],
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    if (files.length === 0) return;
    const branch = await this.resolveBranch(options?.branch);

    // Get latest commit + base tree (may not exist for an empty repo).
    const branchRes = await fetch(
      this.repoUrl(`/git/refs/heads/${encodeURIComponent(branch)}`),
      { headers: this.headers() }
    );

    let latestCommitSha: string | null = null;
    let baseTreeSha: string | null = null;

    if (branchRes.ok) {
      const branchData = await branchRes.json();
      latestCommitSha = branchData.object.sha;

      const commitRes = await fetch(
        this.repoUrl(`/git/commits/${latestCommitSha}`),
        { headers: this.headers() }
      );
      if (!commitRes.ok) {
        throw new Error(`Failed to get commit info: ${commitRes.status}`);
      }
      const commitData = await commitRes.json();
      baseTreeSha = commitData.tree.sha;
    } else if (branchRes.status === 409 || branchRes.status === 404) {
      // Empty / new repo with no commits yet.
    } else {
      throw new Error(`Failed to get branch info: ${branchRes.status}`);
    }

    // Create blobs in parallel.
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const blobRes = await fetch(this.repoUrl('/git/blobs'), {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            content: toBase64(file.content),
            encoding: 'base64',
          }),
        });
        if (!blobRes.ok) {
          const errorData = await blobRes.json().catch(() => ({}));
          throw new Error(
            `Failed to create blob for ${file.path}: ${blobRes.status} - ${errorData.message || blobRes.statusText}`
          );
        }
        const blobData = await blobRes.json();
        return {
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        };
      })
    );

    // Create the new tree.
    const treeBody: Record<string, unknown> = { tree: treeItems };
    if (baseTreeSha) treeBody.base_tree = baseTreeSha;

    const treeRes = await fetch(this.repoUrl('/git/trees'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(treeBody),
    });
    if (!treeRes.ok) {
      throw new Error(`Failed to create tree: ${treeRes.status}`);
    }
    const treeData = await treeRes.json();

    // Create the commit.
    const commitBody: Record<string, unknown> = {
      message,
      tree: treeData.sha,
    };
    if (latestCommitSha) commitBody.parents = [latestCommitSha];

    const newCommitRes = await fetch(this.repoUrl('/git/commits'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(commitBody),
    });
    if (!newCommitRes.ok) {
      throw new Error(`Failed to create commit: ${newCommitRes.status}`);
    }
    const newCommitData = await newCommitRes.json();

    // Move the branch ref forward.
    await this.updateBranchRef(branch, newCommitData.sha);
  }

  // --- delete ---

  async deleteFile(
    path: string,
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    return this.deleteFiles([path], message, options);
  }

  async deleteFiles(
    paths: string[],
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    const branch = await this.resolveBranch(options?.branch);
    const uniquePaths = Array.from(
      new Set(paths.map((p) => p.trim()).filter(Boolean))
    );
    if (uniquePaths.length === 0) {
      throw new Error('没有可删除的文件');
    }

    const { latestCommitSha, fullTree } = await this.fetchHeadTree(branch);

    const deleteSet = new Set(uniquePaths);
    const filteredTree = fullTree.filter((item) => !deleteSet.has(item.path));

    if (filteredTree.length === fullTree.length) {
      throw new Error('未找到要删除的文件');
    }

    await this.commitTreeAndUpdateRef(branch, latestCommitSha, filteredTree, message);
  }

  async deleteDirectory(
    dirPath: string,
    message: string,
    options?: BranchOptions
  ): Promise<void> {
    const branch = await this.resolveBranch(options?.branch);

    // Verify the directory exists and is non-empty.
    const dirRes = await fetch(
      this.repoUrl(
        `/contents/${encodePath(dirPath)}?ref=${encodeURIComponent(branch)}`
      ),
      { headers: this.headers() }
    );
    if (!dirRes.ok) {
      if (dirRes.status === 404) throw new Error('目录不存在');
      throw new Error(`获取目录内容失败: ${dirRes.statusText}`);
    }
    const dirContents = await dirRes.json();
    if (!Array.isArray(dirContents)) {
      throw new Error('目录路径指向的不是一个目录');
    }
    if (dirContents.length === 0) {
      throw new Error('目录为空，无需删除');
    }

    const { latestCommitSha, fullTree } = await this.fetchHeadTree(branch);

    const filteredTree = fullTree.filter((item) => {
      if (item.path === dirPath) return false;
      if (item.path.startsWith(dirPath + '/')) return false;
      return true;
    });

    await this.commitTreeAndUpdateRef(branch, latestCommitSha, filteredTree, message);
  }

  // --- shared internals for tree-rewriting deletes ---

  private async fetchHeadTree(branch: string): Promise<{
    latestCommitSha: string;
    fullTree: Array<{ path: string; mode: string; type: string; sha: string }>;
  }> {
    const branchRes = await fetch(
      this.repoUrl(`/git/refs/heads/${encodeURIComponent(branch)}`),
      { headers: this.headers() }
    );
    if (!branchRes.ok) {
      throw new Error(`获取分支信息失败: ${branchRes.statusText}`);
    }
    const branchData = await branchRes.json();
    const latestCommitSha = branchData.object.sha;

    const commitRes = await fetch(
      this.repoUrl(`/git/commits/${latestCommitSha}`),
      { headers: this.headers() }
    );
    if (!commitRes.ok) {
      throw new Error(`获取commit信息失败: ${commitRes.statusText}`);
    }
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    const treeRes = await fetch(
      this.repoUrl(`/git/trees/${baseTreeSha}?recursive=1`),
      { headers: this.headers() }
    );
    if (!treeRes.ok) {
      throw new Error(`获取tree信息失败: ${treeRes.statusText}`);
    }
    const treeData = await treeRes.json();

    return { latestCommitSha, fullTree: treeData.tree };
  }

  private async commitTreeAndUpdateRef(
    branch: string,
    parentCommitSha: string,
    tree: Array<{ path: string; mode: string; type: string; sha: string }>,
    message: string
  ): Promise<void> {
    const newTreeRes = await fetch(this.repoUrl('/git/trees'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        tree: tree.map((item) => ({
          path: item.path,
          mode: item.mode,
          type: item.type,
          sha: item.sha,
        })),
      }),
    });
    if (!newTreeRes.ok) {
      throw new Error(`创建新tree失败: ${newTreeRes.statusText}`);
    }
    const newTreeData = await newTreeRes.json();

    const newCommitRes = await fetch(this.repoUrl('/git/commits'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message,
        tree: newTreeData.sha,
        parents: [parentCommitSha],
      }),
    });
    if (!newCommitRes.ok) {
      throw new Error(`创建commit失败: ${newCommitRes.statusText}`);
    }
    const newCommitData = await newCommitRes.json();

    await this.updateBranchRef(branch, newCommitData.sha);
  }

  private async updateBranchRef(branch: string, sha: string): Promise<void> {
    const res = await fetch(
      this.repoUrl(`/git/refs/heads/${encodeURIComponent(branch)}`),
      {
        method: 'PATCH',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sha }),
      }
    );
    if (!res.ok) {
      throw new Error(`Failed to update branch: ${res.status}`);
    }
  }
}
