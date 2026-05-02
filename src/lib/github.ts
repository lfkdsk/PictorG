// Backward-compat facade over the cross-platform StorageAdapter
// (src/core/storage). Browser-only helpers (token storage, FileReader,
// document/window/cookie access) live here; everything that actually talks to
// the GitHub HTTP API delegates to GitHubStorageAdapter or core/storage/github.
//
// New code should prefer importing from @/core/storage directly. This file
// exists so existing call sites continue to work unchanged.

import {
  GitHubStorageAdapter,
  base64ToBytes,
  decodePath,
  encodePath,
  GITHUB_API_BASE,
  checkRepositorySecret as coreCheckRepositorySecret,
  checkTokenPermissions as coreCheckTokenPermissions,
  createRepo as coreCreateRepo,
  listRepos as coreListRepos,
  validateToken as coreValidateToken,
} from '@/core/storage';
import type { Repo as CoreRepo, TokenPermissions } from '@/core/storage';

export type Repo = CoreRepo;

function adapterFor(token: string, owner: string, repo: string): GitHubStorageAdapter {
  return new GitHubStorageAdapter({ token, owner, repo });
}

// ---------------------------------------------------------------------------
// Browser-only token & session helpers (DOM/localStorage/cookies).
// ---------------------------------------------------------------------------

export function getGitHubToken(): string | null {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('gh_token');
    if (token) return token;

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'gh_token') {
        return decodeURIComponent(value);
      }
    }
  }
  return null;
}

export async function validateGitHubToken(token: string): Promise<boolean> {
  return coreValidateToken(token);
}

export async function validateCurrentToken(): Promise<boolean> {
  const token = getGitHubToken();
  if (!token) return false;
  return validateGitHubToken(token);
}

export function clearGitHubToken(): void {
  if (typeof window === 'undefined') return;

  const localKeys = [
    'gh_token',
    'github_token',
    'gh_user',
    'gh_token_expiry',
    'pictor_galleries',
    'pictor_repos_cache',
  ];
  localKeys.forEach((k) => localStorage.removeItem(k));

  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('annualSummaryDraft:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }

  const cookiesToClear = ['gh_token', 'github_token'];
  cookiesToClear.forEach((cookieName) => {
    document.cookie = `${cookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    document.cookie = `${cookieName}=; Path=/; Domain=${window.location.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  });

  sessionStorage.removeItem('newAlbumForm');
  sessionStorage.removeItem('uploadedFiles');
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith('annualSummaryDraft:'))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }

  try {
    if ('caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
    }
  } catch (error) {
    console.warn('Failed to clear caches:', error);
  }
}

export function logout(): void {
  clearGitHubToken();
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

// ---------------------------------------------------------------------------
// Path utilities — re-exported from core for backward compatibility.
// ---------------------------------------------------------------------------

export const encodeGitHubPath = encodePath;
export const decodeGitHubPath = decodePath;

// ---------------------------------------------------------------------------
// Repo & branch (delegates to core/storage).
// ---------------------------------------------------------------------------

export async function getDefaultBranch(
  token: string,
  owner: string,
  repo: string
): Promise<string> {
  return adapterFor(token, owner, repo).getDefaultBranch();
}

export async function listRepos(token: string): Promise<Repo[]> {
  return coreListRepos(token);
}

export async function createRepo(
  token: string,
  name: string,
  isPrivate = false
): Promise<Repo> {
  return coreCreateRepo(token, name, isPrivate);
}

// ---------------------------------------------------------------------------
// Single-file read/write (delegates to GitHubStorageAdapter).
// ---------------------------------------------------------------------------

export interface UploadFileOptions {
  owner: string;
  repo: string;
  path: string;
  content: string; // base64 encoded
  message: string;
  branch?: string;
}

export async function uploadFile(token: string, options: UploadFileOptions): Promise<void> {
  const adapter = adapterFor(token, options.owner, options.repo);
  await adapter.writeFile(
    options.path,
    base64ToBytes(options.content),
    options.message,
    { branch: options.branch }
  );
}

export async function fetchGitHubFile(
  token: string,
  owner: string,
  repo: string,
  path: string
): Promise<string> {
  const file = await adapterFor(token, owner, repo).readFile(path);
  return file.text();
}

export async function updateGitHubFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
  branch?: string
): Promise<void> {
  await adapterFor(token, owner, repo).writeFile(path, content, message, { sha, branch });
}

export async function getFileSha(
  token: string,
  owner: string,
  repo: string,
  path: string
): Promise<string | undefined> {
  const meta = await adapterFor(token, owner, repo).readFileMetadata(path);
  return meta?.sha;
}

// ---------------------------------------------------------------------------
// Browser-only file/image helpers.
// ---------------------------------------------------------------------------

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  try {
    const fullUrl = imageUrl.startsWith('/')
      ? `${window.location.origin}${imageUrl}`
      : imageUrl;

    const response = await fetch(fullUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  } catch (error) {
    console.error('Failed to fetch image:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Directory listing (kept on the GitHub side because callers expect the raw
// GitHub Contents API JSON shape).
// ---------------------------------------------------------------------------

export async function getRepoContents(
  token: string,
  owner: string,
  repo: string,
  path = ''
): Promise<any[]> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to get repo contents: ${res.status}`);
  }

  return await res.json();
}

export async function getExistingAlbumUrls(
  token: string,
  owner: string,
  repo: string
): Promise<string[]> {
  const contents = await getRepoContents(token, owner, repo);
  return contents
    .filter((item) => item.type === 'dir')
    .map((item) => item.name);
}

// ---------------------------------------------------------------------------
// Batch uploads & empty-repo init.
// ---------------------------------------------------------------------------

export interface BatchUploadFile {
  path: string;
  content: string; // base64 encoded
}

export async function batchUploadFiles(
  token: string,
  owner: string,
  repo: string,
  files: BatchUploadFile[],
  message: string,
  branch?: string
): Promise<void> {
  // Existing callers pass base64; decode so the adapter sees raw bytes.
  const adapter = adapterFor(token, owner, repo);
  await adapter.batchWriteFiles(
    files.map((f) => ({ path: f.path, content: base64ToBytes(f.content) })),
    message,
    { branch }
  );
}

// Initialize an empty repo by sequentially creating each file via Contents API.
// Root files are created first to seed the repo, then nested files. Kept as
// per-file PUT calls (not the batch tree dance) because GitHub's batch endpoints
// reject requests against a repo with no commits.
export async function initializeEmptyRepo(
  token: string,
  owner: string,
  repo: string,
  files: BatchUploadFile[],
  message: string,
  branch: string = 'main'
): Promise<{ message: string }> {
  const rootFiles = files.filter((file) => !file.path.includes('/'));
  const nestedFiles = files.filter((file) => file.path.includes('/'));

  for (const file of rootFiles) {
    await initRepoPutFile(token, owner, repo, file, branch);
  }

  if (rootFiles.length > 0) {
    // Give GitHub a moment to fully initialize the new repo.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  for (const file of nestedFiles) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await initRepoPutFile(token, owner, repo, file, branch);
  }

  return { message: 'Repository initialized successfully' };
}

// Variant: seed the repo with the first file, then push the rest as one batch
// commit. Faster than initializeEmptyRepo when you have many files.
export async function initializeEmptyRepoWithBatch(
  token: string,
  owner: string,
  repo: string,
  files: BatchUploadFile[],
  message: string,
  branch: string = 'main'
): Promise<void> {
  const firstFile = files[0];
  if (!firstFile) {
    throw new Error('No files to upload');
  }

  await initRepoPutFile(token, owner, repo, firstFile, branch);

  if (files.length === 1) return;

  // Wait for the repo to be fully initialized before the batch push.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await batchUploadFiles(token, owner, repo, files.slice(1), message, branch);
}

// PUT a single file via the Contents API. Used by the empty-repo initialization
// helpers above. If the file already exists, supplies the existing sha so the
// PUT becomes an update.
async function initRepoPutFile(
  token: string,
  owner: string,
  repo: string,
  file: BatchUploadFile,
  branch: string
): Promise<void> {
  // Validate the base64 content fails fast with a clear message.
  try {
    atob(file.content);
  } catch {
    throw new Error(`Invalid base64 encoding for ${file.path}`);
  }

  const checkRes = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${file.path}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${token}`,
      },
    }
  );

  const requestBody: Record<string, unknown> = {
    message: `Add ${file.path}`,
    content: file.content,
    branch,
  };

  if (checkRes.ok) {
    const existing = await checkRes.json();
    requestBody.sha = existing.sha;
    requestBody.message = `Update ${file.path}`;
  }

  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${file.path}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        Authorization: `token ${token}`,
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      `Failed to create ${file.path}: ${res.status} - ${errorData.message || res.statusText}`
    );
  }
}

// ---------------------------------------------------------------------------
// Token permission & secret checks (delegate to core/storage/github/api).
// ---------------------------------------------------------------------------

export async function checkTokenPermissions(token: string): Promise<TokenPermissions> {
  return coreCheckTokenPermissions(token);
}

export async function checkRepositorySecret(
  token: string,
  owner: string,
  repo: string,
  secretName: string
): Promise<boolean> {
  return coreCheckRepositorySecret(token, owner, repo, secretName);
}

// ---------------------------------------------------------------------------
// Imported-gallery cache (browser-only; uses localStorage).
// ---------------------------------------------------------------------------

export async function importRepoToProject(repo: Repo): Promise<boolean> {
  try {
    const GALLERIES_KEY = 'pictor_galleries';
    const existingGalleries = JSON.parse(localStorage.getItem(GALLERIES_KEY) || '[]');

    const exists = existingGalleries.some(
      (gallery: any) => gallery.full_name === repo.full_name
    );
    if (exists) {
      return true;
    }

    const newGallery = {
      id: repo.id,
      full_name: repo.full_name,
      html_url: repo.html_url,
    };

    const updatedGalleries = [...existingGalleries, newGallery];
    localStorage.setItem(GALLERIES_KEY, JSON.stringify(updatedGalleries));
    return true;
  } catch (error) {
    console.error('Failed to import repository:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Delete operations (delegate to GitHubStorageAdapter).
// ---------------------------------------------------------------------------

export async function deleteDirectory(
  token: string,
  owner: string,
  repo: string,
  directoryPath: string,
  message: string,
  branch?: string
): Promise<void> {
  await adapterFor(token, owner, repo).deleteDirectory(directoryPath, message, { branch });
}

export async function deleteFiles(
  token: string,
  owner: string,
  repo: string,
  filePaths: string[],
  message: string,
  branch?: string
): Promise<void> {
  await adapterFor(token, owner, repo).deleteFiles(filePaths, message, { branch });
}
