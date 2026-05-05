// App-managed library of cloned galleries. Wraps a JSON manifest in
// <userData>/galleries.json plus the on-disk repos under <userData>/galleries.
// All filesystem and git work happens here; IPC handlers (ipc/gallery.ts) are
// thin wrappers that translate calls and forward progress events.

import { app, WebContents } from 'electron';
import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SimpleGit } from 'simple-git';

import { ensureGitIdentity, getStoredToken } from '../ipc/auth';
import { buildIsolatedGit } from './isolatedGit';
import type { PushReceipt, UndoResult } from '../ipc/contract';
import type {
  CloneProgress,
  InFlightClone,
  LocalGallery,
  MigrateDirection,
  MigrateProgress,
} from '../../src/core/storage/electron/galleryTypes';
import { CHANNELS } from '../ipc/contract';

const MANIFEST_FILE = 'galleries.json';
const GALLERIES_DIR = 'galleries';

// Sub-directory inside the user's iCloud Drive root where we store
// galleries that opted in to cross-Mac sync. Picked to be visible and
// recognizable in Files.app (on iPhone) and Finder. We deliberately
// don't use a bundle id — iCloud Drive shows the literal folder name.
const ICLOUD_PICG_DIR = 'PicG';

// Marker thrown when clone() is cancelled by cancelClone(). Crosses IPC
// as the error message; the renderer matches on this string to dismiss
// the cloning card silently instead of surfacing an error banner.
export const CLONE_CANCELLED_MESSAGE = 'PICG_CLONE_CANCELLED';

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
  private readonly iCloudRoot: string;
  private cache: LocalGallery[] | null = null;
  // In-flight clones, keyed by galleryId. Lives only in memory: clones
  // don't survive an app restart anyway (the simple-git child process
  // dies with main), so reconstructing this from disk on boot would be
  // misleading. Used by listInFlight() so a renderer that mounts after
  // navigating back to /desktop/galleries can rebuild its progress UI.
  private readonly inFlight = new Map<string, InFlightClone>();
  // Migrations currently running. We refuse to start a second migrate
  // for a gallery that's already moving — the half-copied destination
  // would race the in-progress copy and corrupt one or both.
  private readonly migrating = new Set<string>();
  // AbortController per in-flight clone so cancelClone() can kill the
  // underlying simple-git child process. Separate map (not on the
  // InFlightClone struct) because controllers aren't structured-clone
  // safe and InFlightClone crosses IPC.
  private readonly cloneAborts = new Map<string, AbortController>();

  constructor() {
    const userData = app.getPath('userData');
    this.manifestPath = path.join(userData, MANIFEST_FILE);
    this.galleriesRoot = path.join(userData, GALLERIES_DIR);
    // ~/Library/Mobile Documents/com~apple~CloudDocs is iCloud Drive's
    // canonical mount on macOS. The `com~apple~CloudDocs` token is
    // hard-coded by Apple — it won't change, and there's no public API
    // to discover it (FileProvider's API is iOS-only).
    this.iCloudRoot = path.join(
      app.getPath('home'),
      'Library/Mobile Documents/com~apple~CloudDocs',
      ICLOUD_PICG_DIR
    );
  }

  iCloudGalleriesRoot(): string {
    return this.iCloudRoot;
  }

  // Whether this absolute path lives under the iCloud Drive PicG folder.
  // Used to derive `gallery.storage` on read. Tolerates trailing slashes
  // and normalizes both inputs so a user who copied the path with a
  // typo doesn't silently miss the check.
  isICloudPath(p: string): boolean {
    const root = path.resolve(this.iCloudRoot) + path.sep;
    const candidate = path.resolve(p) + path.sep;
    return candidate.startsWith(root);
  }

  // Add a transient `storage` field to a manifest entry without
  // mutating the cached/persisted shape. Called from every public
  // read path (list, resolve, clone return, sync return, migrate
  // return) so the renderer always sees the right badge.
  private decorate(g: LocalGallery): LocalGallery {
    return {
      ...g,
      storage: this.isICloudPath(g.localPath) ? 'icloud' : 'internal',
    };
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
    const all = await this.readManifest();
    return all.map((g) => this.decorate(g));
  }

  async resolve(id: string): Promise<LocalGallery | null> {
    const all = await this.readManifest();
    const found = all.find((g) => g.id === id);
    return found ? this.decorate(found) : null;
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

    // Register the in-flight entry BEFORE the long-running clone work
    // so a renderer asking listInFlight() between request and the first
    // progress event still sees this clone.
    this.inFlight.set(id, {
      galleryId: id,
      fullName: request.fullName,
      htmlUrl: request.htmlUrl,
    });

    const abortController = new AbortController();
    this.cloneAborts.set(id, abortController);

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

    // Clone runs from the parent of the eventual repo dir (the dir
    // doesn't exist yet) — simple-git's `baseDir` just decides where
    // the child process spawns; the actual destination is the second
    // arg to `git.clone(url, dest)`.
    const git = await buildIsolatedGit(this.galleriesRoot, {
      abort: abortController.signal,
      progress: ({ method, stage, progress, processed, total }) => {
        // simple-git emits progress for both clone and other methods; filter.
        if (method !== 'clone') return;
        // Once cancelled, swallow any in-flight progress callbacks the
        // child may still emit before its process exits. Otherwise the
        // renderer would see post-cancel ticks land on a card it just
        // dismissed and bootstrap a fresh one from the event payload.
        if (abortController.signal.aborted) return;
        const evt: CloneProgress = {
          galleryId: id,
          stage: normalizeStage(stage),
          percent: typeof progress === 'number' ? progress : 0,
          processed,
          total,
          fullName: request.fullName,
          htmlUrl: request.htmlUrl,
        };
        // Cache last progress on the in-flight entry so a renderer that
        // mounts mid-clone via listInFlight() shows the right bar/stage
        // even before the next progress tick lands.
        const entry = this.inFlight.get(id);
        if (entry) entry.lastProgress = evt;
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
      this.inFlight.delete(id);
      const wasCancelled = abortController.signal.aborted;
      this.cloneAborts.delete(id);
      if (wasCancelled) {
        // Throw a marker the renderer can recognize so the picker UI
        // dismisses the card silently instead of surfacing an error
        // banner for a user-initiated cancellation.
        throw new Error(CLONE_CANCELLED_MESSAGE);
      }
      throw err;
    }

    // Strip token from the persisted remote URL.
    try {
      const cleanGit = await buildIsolatedGit(localPath);
      await cleanGit.remote(['set-url', 'origin', request.cloneUrl]);
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
    this.inFlight.delete(id);
    this.cloneAborts.delete(id);
    return this.decorate(gallery);
  }

  // Snapshot of clones currently running. Used by the galleries page on
  // mount to rebuild its progress UI after a navigation away+back: the
  // page's useState is gone but main kept cloning, so we reconstruct
  // entries from this list and resume listening for progress events.
  listInFlight(): InFlightClone[] {
    return [...this.inFlight.values()].map((entry) => ({ ...entry }));
  }

  // Cancel an in-flight clone. Idempotent — a no-op if the clone has
  // already finished or was never started. Aborting fires the simple-git
  // abort plugin, which kills the underlying child process; the catch
  // block in clone() then handles directory cleanup and rejects the
  // pending IPC response with CLONE_CANCELLED_MESSAGE.
  cancelClone(id: string): void {
    const controller = this.cloneAborts.get(id);
    if (!controller) return;
    controller.abort();
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

    // forCommits: true because `git pull` may need to author a merge
    // commit when the remote isn't a fast-forward. With the global
    // gitconfig wiped we have to supply user.name/user.email ourselves.
    const git = await buildIsolatedGit(gallery.localPath, { forCommits: true });
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
    return this.decorate(updated);
  }

  async push(id: string): Promise<PushReceipt> {
    const gallery = await this.resolve(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);
    // forCommits: true because maybeSquash() runs a `git commit` to
    // record the squashed commit. Identity comes from the OAuth token,
    // not from the user's (now-ignored) ~/.gitconfig.
    const git = await buildIsolatedGit(gallery.localPath, { forCommits: true });
    const branch = await currentBranch(git);

    // Snapshot the pending commits BEFORE squashing — we need their
    // subjects + authors for the PushReceipt, and after the soft-reset
    // in maybeSquash() the original commits are no longer reachable
    // from HEAD (they live in reflog only).
    const pending = await this.collectPendingCommits(git, branch);

    // Squash all unpushed commits into one before pushing. The renderer
    // commits per individual operation (drag reorder → 1, edit album →
    // 1, batch photo upload → 1, …) so the Undo toast can `git reset
    // --hard HEAD~1` a single step at a time. That granularity shows
    // up in `git log` as 5+ commits per editing session — noisy on the
    // remote. We collapse the whole un-pushed range into a single
    // commit at push time so origin's history stays readable while
    // local Undo keeps working session-internal.
    //
    // Safety: stash the pre-squash SHA so we can restore the granular
    // history if anything below fails (squash itself, or the actual
    // push). User loses no work — the commits are still reachable
    // from reflog even after a hard reset.
    const preSquashSha = await this.maybeSquash(git, branch);

    // Two competing requirements for how we get the OAuth token to git:
    //
    //   (a) the token must NOT live in .git/config (would persist on
    //       disk, leak via backups / iCloud sync / accidental commits)
    //   (b) `refs/remotes/origin/<branch>` must update after a push,
    //       otherwise the Topbar's ahead-counter looks stuck on N
    //       forever even though origin actually got the commits
    //
    // The previous trick — `git -c remote.origin.url=https://oauth2:<token>@... push origin <branch>` —
    // looked like it satisfied both, but doesn't actually work:
    // git SILENTLY drops credentials supplied via -c config. They only
    // reach git's HTTP transport when they're either persisted in
    // .git/config or passed positionally to push/pull. (Verified
    // 2026-05-04 against git 2.39: the -c path produces the exact
    // "could not read Username for 'https://github.com'" error the
    // user was hitting after the §4.2 isolation locked SSH off.)
    //
    // The fix: push POSITIONALLY (creds reach the transport), then
    // update the tracking ref ourselves with `update-ref` (purely
    // local, no second network round trip). `git push <url> HEAD:<branch>`
    // updates HEAD on the remote but doesn't touch the local
    // `refs/remotes/origin/<branch>`, so we explicitly bump it to the
    // newly-pushed SHA — which by definition equals HEAD because the
    // push just succeeded.
    //
    // Note: http.postBuffer / http.version / credential.helper-clear /
    // SSH disablement / askPass disablement are all baked into the
    // isolated-git helper now — see electron/galleries/isolatedGit.ts.
    try {
      await git.raw([
        'push',
        this.tokenizedUrl(gallery),
        `HEAD:${branch}`,
      ]);
    } catch (err) {
      if (preSquashSha) {
        // Push failed — undo the squash so the user keeps the
        // per-operation Undo grain. The next Push attempt re-squashes.
        await git.raw(['reset', '--hard', preSquashSha]).catch(() => {});
      }
      throw err;
    }

    // Push succeeded — sync the local tracking ref. Failures here
    // are non-fatal: the push happened, the user's data is on origin,
    // and the worst symptom of a missed update-ref is a stale ahead
    // count that next push() will recompute. We log instead of
    // throwing so we don't trigger the squash rollback above on a
    // post-success error.
    await git
      .raw(['update-ref', `refs/remotes/origin/${branch}`, 'HEAD'])
      .catch((err: unknown) => {
        console.warn(
          `[picg] push to ${gallery.fullName} succeeded but update-ref failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });

    // Build the receipt the renderer surfaces as a post-push card.
    // `pushedSha` is whatever HEAD points at right now — equal to the
    // squash commit when we squashed, equal to the granular HEAD when
    // we didn't.
    const pushedSha = (await git.revparse(['HEAD'])).trim();
    const identity = await ensureGitIdentity();
    const distinctAuthors = dedupeAuthors(pending.map((c) => c.author));

    return {
      identity,
      target: {
        fullName: gallery.fullName,
        branch,
        remoteUrl: gallery.cloneUrl,
      },
      pushedSha,
      // Squash receipt only when 2+ commits actually got collapsed.
      // Single-commit pushes don't trigger maybeSquash, so reporting
      // a "1 op was collapsed" would be misleading.
      squash:
        pending.length >= 2
          ? { collapsed: pending.map((c) => c.subject) }
          : null,
      authors: distinctAuthors,
    };
  }

  // Snapshot of un-pushed commits, oldest-first, for the PushReceipt.
  // Returns [] when there's no upstream tracking ref (first push) —
  // we don't have a baseline to diff against. Errors swallowed for
  // the same reason as maybeSquash: a missing upstream is normal.
  private async collectPendingCommits(
    git: SimpleGit,
    branch: string
  ): Promise<Array<{ sha: string; subject: string; author: { name: string; email: string } }>> {
    try {
      const log = await git.log({ from: `origin/${branch}`, to: 'HEAD' });
      // simple-git's `log.all` is newest-first; reverse for chronological
      // (oldest-first) order so the renderer can show "first you did X,
      // then Y, then Z, all squashed into one commit".
      return log.all
        .map((c) => ({
          sha: c.hash,
          subject: c.message.split('\n')[0],
          author: { name: c.author_name, email: c.author_email },
        }))
        .reverse();
    } catch {
      return [];
    }
  }

  // Returns the pre-squash SHA if a squash happened, null if no-op.
  // A no-op means: no upstream tracking ref yet, or fewer than 2
  // commits ahead (nothing to collapse).
  private async maybeSquash(
    git: SimpleGit,
    branch: string
  ): Promise<string | null> {
    const upstream = `origin/${branch}`;
    let aheadCount: number;
    try {
      const out = await git.raw(['rev-list', '--count', `${upstream}..HEAD`]);
      aheadCount = parseInt(out.trim(), 10) || 0;
    } catch {
      // No upstream branch → first push, nothing to squash against.
      return null;
    }
    if (aheadCount < 2) return null;

    const headSha = (await git.revparse(['HEAD'])).trim();

    // Build a single commit message that lists each squashed subject
    // line in chronological order. Keeps the squashed history
    // self-documenting on the remote.
    const log = await git.log({
      from: upstream,
      to: 'HEAD',
    });
    const subjects = log.all
      .map((c) => c.message.split('\n')[0])
      .reverse()
      .map((s) => `- ${s}`)
      .join('\n');
    const message = `Update from PicG · ${aheadCount} ops\n\n${subjects}`;

    try {
      // Soft reset preserves working tree + index — staging stays
      // exactly as it was at HEAD. Then a single commit re-records it.
      await git.raw(['reset', '--soft', upstream]);
      await git.commit(message);
    } catch (err) {
      // Squash itself failed — restore and bail.
      await git.raw(['reset', '--hard', headSha]).catch(() => {});
      throw err;
    }
    return headSha;
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

  // Roll back the last commit on the current branch. Used by the Undo
  // toast that fires after each renderer-driven mutation.
  //
  // Refuses three cases:
  //   - 'already-pushed': commit is at or below origin/<branch>.
  //     Rewriting it now would mean force-push, which we never do
  //     without explicit user intent.
  //   - 'no-prior-commit': there's no HEAD~1 to reset to (fresh repo).
  //   - 'dirty': uncommitted changes in the working tree. We'd lose them.
  //
  // Otherwise: `git reset --hard HEAD~1`. The commit's subject line is
  // returned so the toast can surface "Reverted: <message>".
  async undoLastCommit(id: string): Promise<UndoResult> {
    const gallery = await this.resolve(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);
    // Read-only-ish — we hard-reset HEAD~1, no new commit authored,
    // so identity isn't required.
    const git = await buildIsolatedGit(gallery.localPath);

    const status = await git.status();
    if (!status.isClean()) return { ok: false, refused: 'dirty' };

    // Confirm there's a commit before HEAD on this branch.
    let priorSubject: string;
    try {
      priorSubject = (await git.raw(['log', '-1', '--pretty=%s', 'HEAD'])).trim();
    } catch {
      return { ok: false, refused: 'no-prior-commit' };
    }
    try {
      await git.raw(['rev-parse', '--verify', 'HEAD~1']);
    } catch {
      return { ok: false, refused: 'no-prior-commit' };
    }

    // If origin/<branch> already contains HEAD, undoing means rewriting
    // pushed history. Bail.
    const branch = status.current ?? '';
    if (branch) {
      try {
        const remoteSha = (
          await git.raw(['rev-parse', `origin/${branch}`])
        ).trim();
        const isAncestor = await git
          .raw(['merge-base', '--is-ancestor', 'HEAD', remoteSha])
          .then(() => true)
          .catch(() => false);
        if (isAncestor) return { ok: false, refused: 'already-pushed' };
      } catch {
        // No origin/<branch> configured — that's fine, treat as un-pushed.
      }
    }

    await git.raw(['reset', '--hard', 'HEAD~1']);
    return { ok: true, reverted: priorSubject };
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
    const git = await buildIsolatedGit(gallery.localPath);
    const s = await git.status();
    return {
      current: s.current ?? '',
      ahead: s.ahead,
      behind: s.behind,
      dirty: !s.isClean(),
    };
  }

  // --- iCloud migration ---

  // Move a gallery's working tree into the user's iCloud Drive
  // (`~/Library/Mobile Documents/com~apple~CloudDocs/PicG/<id>/`). The
  // manifest's `localPath` is updated atomically — we copy first, verify,
  // then swap the manifest, then delete the source. Failure at any step
  // before the swap leaves the original directory intact, so the worst
  // case is a half-written iCloud copy that we clean up before
  // surfacing the error.
  async migrateToICloud(
    id: string,
    sender: WebContents | null = null
  ): Promise<LocalGallery> {
    return this.migrate(id, 'to-icloud', sender);
  }

  // Reverse migration: pull a gallery out of iCloud back into the
  // app's userData. Useful if the user is hitting iCloud quota issues
  // or wants to stop syncing a particular library.
  async migrateToInternal(
    id: string,
    sender: WebContents | null = null
  ): Promise<LocalGallery> {
    return this.migrate(id, 'to-internal', sender);
  }

  private async migrate(
    id: string,
    direction: MigrateDirection,
    sender: WebContents | null
  ): Promise<LocalGallery> {
    if (this.migrating.has(id)) {
      throw new Error(`Migration already in progress for ${id}`);
    }
    if (this.inFlight.has(id)) {
      throw new Error(`Cannot migrate while a clone is running for ${id}`);
    }
    const gallery = await this.resolveRaw(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);

    const isICloudNow = this.isICloudPath(gallery.localPath);
    if (direction === 'to-icloud' && isICloudNow) {
      throw new Error('Gallery already lives in iCloud Drive.');
    }
    if (direction === 'to-internal' && !isICloudNow) {
      throw new Error('Gallery already lives in the app data directory.');
    }

    const dst =
      direction === 'to-icloud'
        ? path.join(this.iCloudRoot, id)
        : path.join(this.galleriesRoot, id);

    // Refuse to clobber an existing destination — if the user has a
    // half-finished migration sitting in iCloud from a previous run,
    // they should clean it up themselves rather than have us silently
    // merge.
    try {
      await fs.access(dst);
      throw new Error(
        `Destination already exists: ${dst}. Remove it manually before retrying.`
      );
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }

    this.migrating.add(id);
    const emit = (evt: MigrateProgress) => {
      try {
        sender?.send(CHANNELS.gallery.migrateProgress, evt);
      } catch {
        /* renderer might be gone; ignore */
      }
    };

    try {
      // Make sure the parent directory exists. For iCloud this also
      // implicitly creates `~/.../com~apple~CloudDocs/PicG/` on first
      // migration; the fileprovider materializes it as a real folder.
      await fs.mkdir(path.dirname(dst), { recursive: true });

      emit({ galleryId: id, direction, phase: 'counting' });
      const entries = await this.listAll(gallery.localPath);
      const totalFiles = entries.reduce((n, e) => (e.isDir ? n : n + 1), 0);
      emit({
        galleryId: id,
        direction,
        phase: 'counting',
        total: totalFiles,
      });

      // Phase: copying. We mkdir the destination root first, then
      // walk entries and copy each file. mkdir-on-each-file's parent
      // is recursive+idempotent — a few extra cheap syscalls beat
      // having to sort the entries list ourselves.
      await fs.mkdir(dst, { recursive: true });
      let processed = 0;
      for (const entry of entries) {
        const srcPath = path.join(gallery.localPath, entry.rel);
        const dstPath = path.join(dst, entry.rel);
        if (entry.isDir) {
          await fs.mkdir(dstPath, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(dstPath), { recursive: true });
          await fs.copyFile(srcPath, dstPath);
          processed += 1;
          // Throttle progress to roughly one event per 25 files so
          // the renderer's React reconciler doesn't melt on a
          // 5000-photo migration. Always emit the final file.
          if (processed % 25 === 0 || processed === totalFiles) {
            emit({
              galleryId: id,
              direction,
              phase: 'copying',
              processed,
              total: totalFiles,
              current: entry.rel,
            });
          }
        }
      }

      // Phase: verifying. Cheap sanity check — count files at the
      // destination, must match the source's count we already
      // computed. If a copyFile silently dropped a file (it doesn't,
      // but defense in depth), we catch it before deleting the
      // source.
      emit({ galleryId: id, direction, phase: 'verifying', total: totalFiles });
      const dstEntries = await this.listAll(dst);
      const dstFiles = dstEntries.reduce((n, e) => (e.isDir ? n : n + 1), 0);
      if (dstFiles !== totalFiles) {
        throw new Error(
          `Verification failed: source had ${totalFiles} files, destination has ${dstFiles}.`
        );
      }

      // Atomically swap the manifest entry. Updating localPath is the
      // commit point of the migration: from here on, every read goes
      // through the new path. The old directory is just garbage we
      // delete next.
      const items = await this.readManifest();
      const updated: LocalGallery = { ...gallery, localPath: dst };
      const next = items.map((g) => (g.id === id ? updated : g));
      await this.writeManifest(next);

      emit({ galleryId: id, direction, phase: 'cleanup' });
      await fs.rm(gallery.localPath, { recursive: true, force: true }).catch(
        (err) => {
          // Source removal failed but the manifest is already pointing
          // at the new path, so the user's experience is correct.
          // Surface to console for the spike — orphaned source is
          // recoverable manually.
          console.warn(
            `[picg] migrate: failed to remove source ${gallery.localPath}: ${
              err?.message ?? err
            }`
          );
        }
      );

      // For migrations into iCloud, kick off `brctl download` on the
      // new path so the file provider materializes it on this Mac
      // immediately instead of lazily. Async — we don't block the
      // UI on the download finishing.
      if (direction === 'to-icloud') {
        this.triggerICloudDownload([dst]).catch(() => {
          /* logged inside */
        });
      }

      emit({
        galleryId: id,
        direction,
        phase: 'done',
        processed: totalFiles,
        total: totalFiles,
      });
      return this.decorate(updated);
    } catch (err) {
      // Best-effort cleanup of the half-copied destination. If it
      // doesn't exist (we never got past mkdir) the rm is a no-op.
      await fs.rm(dst, { recursive: true, force: true }).catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      emit({ galleryId: id, direction, phase: 'error', error: message });
      throw err;
    } finally {
      this.migrating.delete(id);
    }
  }

  // Scan ~/.../PicG/ for galleries that aren't in this machine's
  // manifest. Used at startup so a gallery the user migrated to
  // iCloud on Mac A automatically shows up on Mac B without re-cloning.
  //
  // Discovery is conservative: a folder qualifies if it (a) has a
  // `.git` directory, (b) has a remote named `origin`, and (c) the
  // remote URL parses as a GitHub https clone URL. Anything else is
  // ignored — better to miss a gallery than to add a stray folder
  // the user dropped in PicG/ for some other reason.
  //
  // Returns the newly-added gallery records (decorated). Empty array
  // means nothing changed.
  async discoverICloud(): Promise<LocalGallery[]> {
    let entries: string[];
    try {
      const dirents = await fs.readdir(this.iCloudRoot, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err: any) {
      // ENOENT = no PicG folder yet (first launch on this machine, or
      // user never migrated anything to iCloud). Not an error.
      if (err?.code === 'ENOENT') return [];
      throw err;
    }

    const existing = await this.readManifest();
    const seen = new Set(existing.map((g) => g.id));
    const additions: LocalGallery[] = [];

    for (const id of entries) {
      if (seen.has(id)) continue;
      const candidate = path.join(this.iCloudRoot, id);
      const gallery = await this.tryRecognizeGallery(id, candidate).catch(
        (err) => {
          console.warn(
            `[picg] discoverICloud: skipping ${candidate}: ${
              err?.message ?? err
            }`
          );
          return null;
        }
      );
      if (gallery) additions.push(gallery);
    }

    if (additions.length === 0) return [];

    const next = [...existing, ...additions];
    await this.writeManifest(next);
    return additions.map((g) => this.decorate(g));
  }

  // Recognize a directory as a PicG gallery and produce a manifest
  // entry for it. Reads the git remote to derive owner / repo / clone
  // URL; rejects anything that doesn't look like a GitHub https remote
  // (`https://github.com/<owner>/<repo>.git`). Folder name must
  // already match `<owner>__<repo>` since that's our manifest id.
  private async tryRecognizeGallery(
    id: string,
    dirPath: string
  ): Promise<LocalGallery | null> {
    // Parse `<owner>__<repo>` from the folder name. We never silently
    // synthesize an id from the remote, because the folder name is
    // what determines our manifest key — getting it from somewhere
    // else risks two manifest entries for the same on-disk folder.
    const sep = id.indexOf('__');
    if (sep <= 0 || sep === id.length - 2) return null;
    const owner = id.slice(0, sep);
    const repo = id.slice(sep + 2);

    // Confirm `.git` exists. Without it, this isn't a clone — could
    // be a stray folder the user created.
    try {
      const gitStat = await fs.stat(path.join(dirPath, '.git'));
      if (!gitStat.isDirectory()) return null;
    } catch {
      return null;
    }

    let remoteUrl = '';
    try {
      const probe = await buildIsolatedGit(dirPath);
      remoteUrl = (await probe.remote(['get-url', 'origin']))
        ?.toString()
        .trim() ?? '';
    } catch {
      return null;
    }
    if (!remoteUrl) return null;

    // Accept https://github.com/<owner>/<repo>(.git)? — we don't
    // support ssh remotes for cloning anyway (token-based https is
    // the entire auth model in clone()).
    const m = remoteUrl.match(
      /^https:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/
    );
    if (!m) return null;
    const [, remoteOwner, remoteRepo] = m;
    if (remoteOwner !== owner || remoteRepo !== repo) {
      // Folder name disagrees with the remote — refuse rather than
      // silently importing under the wrong id.
      return null;
    }

    // Best-effort default branch: ask git for HEAD's branch. simpleGit
    // returns empty when on a detached HEAD; we leave defaultBranch
    // undefined in that case rather than guessing.
    let defaultBranch: string | undefined;
    try {
      const probe = await buildIsolatedGit(dirPath);
      const branchInfo = await probe.branch();
      defaultBranch = branchInfo.current || undefined;
    } catch {
      /* leave undefined */
    }

    const sizeBytes = await measureDirSize(dirPath).catch(() => 0);

    return {
      id,
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      htmlUrl: `https://github.com/${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      localPath: dirPath,
      defaultBranch,
      addedAt: new Date().toISOString(),
      sizeBytes,
    };
  }

  // Fire `brctl download` for one or more iCloud paths. Async,
  // non-blocking — `brctl` returns when the file provider has queued
  // the download, not when it's finished. Treats failures as warnings
  // because brctl might be missing on a stripped macOS install or
  // the user might not be signed into iCloud; either way we continue.
  //
  // If `paths` is undefined, downloads every gallery currently in the
  // manifest whose localPath is under iCloud — used at startup.
  async triggerICloudDownload(paths?: string[]): Promise<void> {
    let targets: string[];
    if (paths) {
      targets = paths;
    } else {
      const all = await this.readManifest();
      targets = all
        .filter((g) => this.isICloudPath(g.localPath))
        .map((g) => g.localPath);
    }
    if (targets.length === 0) return;

    await Promise.all(
      targets.map(
        (p) =>
          new Promise<void>((resolve) => {
            // brctl is a single-arg CLI: `brctl download <path>`. We
            // shell-out via exec rather than spawn because the path
            // is from our own manifest (never user-controlled at this
            // layer) and exec lets us shell-quote with one argument
            // string. JSON.stringify gives us a properly-quoted shell
            // string for any path, including ones with spaces or
            // single quotes.
            exec(
              `brctl download ${JSON.stringify(p)}`,
              { timeout: 60_000 },
              (err) => {
                if (err) {
                  console.warn(
                    `[picg] brctl download failed for ${p}: ${err.message}`
                  );
                }
                resolve();
              }
            );
          })
      )
    );
  }

  // Like resolve() but returns the persisted shape (no `storage`
  // decoration). Internal helper for migrate, which needs the bare
  // record so the next writeManifest doesn't accidentally persist the
  // derived field.
  private async resolveRaw(id: string): Promise<LocalGallery | null> {
    const all = await this.readManifest();
    return all.find((g) => g.id === id) ?? null;
  }

  // Recursive directory walk, returning entries in a flat list keyed
  // by their relative path. Used by migrate() to count files for
  // progress and to drive the copy. Skips symlinks (gallery contents
  // are photos + git objects, neither of which the renderer can
  // create).
  private async listAll(
    root: string
  ): Promise<{ rel: string; isDir: boolean }[]> {
    const out: { rel: string; isDir: boolean }[] = [];
    const stack: string[] = [''];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const dir = cur ? path.join(root, cur) : root;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const rel = cur ? path.join(cur, e.name) : e.name;
        if (e.isDirectory()) {
          out.push({ rel, isDir: true });
          stack.push(rel);
        } else if (e.isFile()) {
          out.push({ rel, isDir: false });
        }
        // symlinks intentionally skipped — see method comment
      }
    }
    return out;
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

async function currentBranch(git: SimpleGit): Promise<string> {
  // simple-git's `branch()` returns { current, ...all } — `current` is the
  // checked-out branch name. Default to 'HEAD' so push/pull still works
  // on a freshly-cloned repo where the branch metadata isn't fully
  // populated yet (rare, but cheap to guard against).
  const info = await git.branch();
  return info.current || 'HEAD';
}

// Distinct-by-email author dedupe for the PushReceipt. Stable order
// (first occurrence wins) so the renderer can show authors in the
// chronological order they appeared in the un-pushed range. Email is
// the dedupe key because GitHub web display name can drift while the
// noreply email is canonical.
function dedupeAuthors(
  authors: Array<{ name: string; email: string }>
): Array<{ name: string; email: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; email: string }> = [];
  for (const a of authors) {
    const key = a.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}
