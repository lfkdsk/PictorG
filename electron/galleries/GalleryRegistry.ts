// App-managed library of cloned galleries. Wraps a JSON manifest in
// <userData>/galleries.json plus the on-disk repos under <userData>/galleries.
// All filesystem and git work happens here; IPC handlers (ipc/gallery.ts) are
// thin wrappers that translate calls and forward progress events.

import { app, WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import simpleGit from 'simple-git';

import { getStoredToken } from '../ipc/auth';
import type { CloneProgress, LocalGallery } from '../../src/core/storage/electron/galleryTypes';

const MANIFEST_FILE = 'galleries.json';
const GALLERIES_DIR = 'galleries';

function galleryIdFor(owner: string, repo: string): string {
  // owner__repo — `__` is rare in GitHub slugs and stays filesystem-safe.
  return `${owner}__${repo}`;
}

// Recursive directory size in bytes. Used to populate gallery card capacity
// after a clone or sync completes.
async function measureDirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await measureDirSize(child);
    } else if (entry.isFile()) {
      const stat = await fs.stat(child);
      total += stat.size;
    }
  }
  return total;
}

export type CloneRequest = {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;       // https://github.com/owner/repo.git
  defaultBranch?: string;
};

export class GalleryRegistry {
  private readonly manifestPath: string;
  private readonly galleriesRoot: string;
  private cache: LocalGallery[] | null = null;

  constructor() {
    const userData = app.getPath('userData');
    this.manifestPath = path.join(userData, MANIFEST_FILE);
    this.galleriesRoot = path.join(userData, GALLERIES_DIR);
  }

  // --- manifest ---

  private async readManifest(): Promise<LocalGallery[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.manifestPath, 'utf-8');
      this.cache = JSON.parse(raw);
      return this.cache!;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.cache = [];
        return this.cache;
      }
      throw err;
    }
  }

  private async writeManifest(items: LocalGallery[]): Promise<void> {
    await fs.mkdir(path.dirname(this.manifestPath), { recursive: true });
    await fs.writeFile(this.manifestPath, JSON.stringify(items, null, 2), 'utf-8');
    this.cache = items;
  }

  async list(): Promise<LocalGallery[]> {
    return [...(await this.readManifest())];
  }

  async resolve(id: string): Promise<LocalGallery | null> {
    const all = await this.readManifest();
    return all.find((g) => g.id === id) ?? null;
  }

  // --- clone ---

  async clone(
    request: CloneRequest,
    sender: WebContents
  ): Promise<LocalGallery> {
    const id = galleryIdFor(request.owner, request.repo);
    const localPath = path.join(this.galleriesRoot, id);

    // Refuse to overwrite an existing managed gallery — it's almost certainly
    // a user mistake (re-adding the same repo) and the right answer is "open
    // the existing one".
    const existing = await this.resolve(id);
    if (existing) {
      throw new Error(`Gallery already exists: ${request.fullName}`);
    }
    try {
      await fs.access(localPath);
      throw new Error(
        `Local path already exists but isn't tracked: ${localPath}. Remove it manually.`
      );
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }

    await fs.mkdir(this.galleriesRoot, { recursive: true });

    const token = getStoredToken();
    if (!token) {
      throw new Error(
        'Not signed in — open Pictor and complete GitHub sign-in before cloning.'
      );
    }
    // Token-bearing URL for the clone. We immediately strip it from the
    // remote afterwards so the token doesn't persist in .git/config. The
    // token itself comes from the OS keychain, never from the renderer.
    const tokenUrl = request.cloneUrl.replace(
      'https://',
      `https://oauth2:${encodeURIComponent(token)}@`
    );

    const git = simpleGit({
      progress: ({ method, stage, progress, processed, total }) => {
        // simple-git emits progress for both clone and other methods; filter.
        if (method !== 'clone') return;
        const evt: CloneProgress = {
          galleryId: id,
          stage: normalizeStage(stage),
          percent: typeof progress === 'number' ? progress : 0,
          processed,
          total,
        };
        try {
          sender.send('gallery:clone-progress', evt);
        } catch {
          /* renderer might be gone; ignore */
        }
      },
    });

    try {
      await git.clone(tokenUrl, localPath, ['--progress']);
    } catch (err) {
      // Clean up partial directory so retry works cleanly.
      await fs.rm(localPath, { recursive: true, force: true }).catch(() => {});
      throw err;
    }

    // Strip token from the persisted remote URL.
    try {
      await simpleGit(localPath).remote(['set-url', 'origin', request.cloneUrl]);
    } catch {
      /* non-fatal — leaving tokenized URL would be a security concern but the
         clone itself succeeded; surface via console for the spike */
      console.warn(`Could not reset remote URL for ${id}; .git/config may contain token`);
    }

    const sizeBytes = await measureDirSize(localPath).catch(() => 0);

    const gallery: LocalGallery = {
      id,
      owner: request.owner,
      repo: request.repo,
      fullName: request.fullName,
      htmlUrl: request.htmlUrl,
      cloneUrl: request.cloneUrl,
      localPath,
      defaultBranch: request.defaultBranch,
      addedAt: new Date().toISOString(),
      sizeBytes,
    };

    const items = await this.readManifest();
    await this.writeManifest([...items, gallery]);
    return gallery;
  }

  // --- remove / sync ---

  async remove(id: string): Promise<void> {
    const items = await this.readManifest();
    const gallery = items.find((g) => g.id === id);
    if (!gallery) return;

    await fs.rm(gallery.localPath, { recursive: true, force: true }).catch(() => {});
    await this.writeManifest(items.filter((g) => g.id !== id));
  }

  async sync(id: string): Promise<LocalGallery> {
    const gallery = await this.resolve(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);

    const git = simpleGit(gallery.localPath);
    const branch = await currentBranch(git);
    await git.pull(this.tokenizedUrl(gallery), branch);

    const sizeBytes = await measureDirSize(gallery.localPath).catch(() => 0);
    const updated: LocalGallery = {
      ...gallery,
      lastSyncAt: new Date().toISOString(),
      sizeBytes,
    };
    const items = await this.readManifest();
    const next = items.map((g) => (g.id === id ? updated : g));
    await this.writeManifest(next);
    return updated;
  }

  async push(id: string): Promise<void> {
    const gallery = await this.resolve(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);
    const git = simpleGit(gallery.localPath);
    const branch = await currentBranch(git);
    // Push using a one-shot tokenized URL. We deliberately *don't* fall
    // back to the persisted origin URL (which we de-tokenized after clone)
    // — that path triggers the OS credential helper on every push, which
    // adds 5–30s of stall on macOS even when the keychain entry exists.
    await git.push(this.tokenizedUrl(gallery), branch);
  }

  // Build a one-shot https://oauth2:<token>@github.com/... URL. Never
  // persisted to .git/config — only passed inline to push/pull.
  private tokenizedUrl(gallery: LocalGallery): string {
    const token = getStoredToken();
    if (!token) {
      throw new Error(
        'Not signed in — open Pictor and complete GitHub sign-in before syncing.'
      );
    }
    return gallery.cloneUrl.replace(
      'https://',
      `https://oauth2:${encodeURIComponent(token)}@`
    );
  }

  // ahead/behind reflect local-vs-last-known-remote, no fetch involved.
  // After a `push` ahead resets to 0; after a `sync` behind resets to 0.
  // dirty signals an uncommitted working-tree change (rare here since the
  // adapter always commits, but useful for debugging).
  async status(
    id: string
  ): Promise<{ current: string; ahead: number; behind: number; dirty: boolean }> {
    const gallery = await this.resolve(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);
    const git = simpleGit(gallery.localPath);
    const s = await git.status();
    return {
      current: s.current ?? '',
      ahead: s.ahead,
      behind: s.behind,
      dirty: !s.isClean(),
    };
  }
}

function normalizeStage(stage: string): CloneProgress['stage'] {
  const s = stage.toLowerCase();
  if (s.includes('receiv')) return 'receiving';
  if (s.includes('resolv')) return 'resolving';
  if (s.includes('writ')) return 'writing';
  if (s.includes('compress')) return 'compressing';
  return 'other';
}

async function currentBranch(git: ReturnType<typeof simpleGit>): Promise<string> {
  // simple-git's `branch()` returns { current, ...all } — `current` is the
  // checked-out branch name. Default to 'HEAD' so push/pull still works
  // on a freshly-cloned repo where the branch metadata isn't fully
  // populated yet (rare, but cheap to guard against).
  const info = await git.branch();
  return info.current || 'HEAD';
}
