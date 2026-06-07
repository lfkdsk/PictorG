// App-managed library of cloned galleries. Wraps a JSON manifest in
// <userData>/galleries.json plus the on-disk repos under <userData>/galleries.
// All filesystem and git work happens here; IPC handlers (ipc/gallery.ts) are
// thin wrappers that translate calls and forward progress events.

import { app, WebContents } from 'electron';
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
} from '../../src/core/storage/electron/galleryTypes';

const MANIFEST_FILE = 'galleries.json';
const GALLERIES_DIR = 'galleries';

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
  private cache: LocalGallery[] | null = null;
  // In-flight clones, keyed by galleryId. Lives only in memory: clones
  // don't survive an app restart anyway (the simple-git child process
  // dies with main), so reconstructing this from disk on boot would be
  // misleading. Used by listInFlight() so a renderer that mounts after
  // navigating back to /desktop/galleries can rebuild its progress UI.
  private readonly inFlight = new Map<string, InFlightClone>();
  // AbortController per in-flight clone so cancelClone() can kill the
  // underlying simple-git child process. Separate map (not on the
  // InFlightClone struct) because controllers aren't structured-clone
  // safe and InFlightClone crosses IPC.
  private readonly cloneAborts = new Map<string, AbortController>();

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
    const all = await this.readManifest();
    return all.map((g) => ({ ...g }));
  }

  async resolve(id: string): Promise<LocalGallery | null> {
    const all = await this.readManifest();
    const found = all.find((g) => g.id === id);
    return found ? { ...found } : null;
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
    return { ...gallery };
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
    // Drop the local photo-index cache (sqlite.db / db-meta / exif-cache) too,
    // so it doesn't orphan under <userData>/photo-index after the gallery is
    // gone. `id` is this gallery's own manifest id (owner__repo) — no traversal.
    await fs
      .rm(path.join(app.getPath('userData'), 'photo-index', id), {
        recursive: true,
        force: true,
      })
      .catch(() => {});
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
    return { ...updated };
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
    //       disk, leak via backups / accidental commits)
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

  // Public read-only view of the un-pushed commit list — what the
  // Topbar push button's hover tooltip displays so the user can see
  // exactly which operations the next push will ship before clicking.
  // Same data source as collectPendingCommits (which fuels the
  // post-push receipt and the squash-message body); promoted here so
  // the renderer can read it without triggering a push.
  //
  // Returns [] when there's no upstream / nothing ahead. Errors are
  // swallowed by collectPendingCommits, so this is best-effort: if the
  // log query fails for any reason the tooltip simply shows the
  // ahead-counter without a list, never an error.
  async unpushedCommits(
    id: string
  ): Promise<Array<{ sha: string; subject: string; author: { name: string; email: string } }>> {
    const gallery = await this.resolve(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);
    const git = await buildIsolatedGit(gallery.localPath);
    const status = await git.status();
    const branch = status.current ?? '';
    if (!branch) return [];
    return this.collectPendingCommits(git, branch);
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
    return this.readStatus(git);
  }

  // Network-backed status refresh for page entry. We fetch the current
  // branch into origin/<branch> using the one-shot tokenized URL, then
  // read the same local status shape as status(). Keeping this separate
  // preserves status() as cheap local plumbing for gallery.changed
  // broadcasts after renderer-side writes.
  async refreshStatus(
    id: string
  ): Promise<{ current: string; ahead: number; behind: number; dirty: boolean }> {
    const gallery = await this.resolve(id);
    if (!gallery) throw new Error(`Gallery not found: ${id}`);
    const git = await buildIsolatedGit(gallery.localPath);
    const branch = await currentBranch(git);
    if (branch && branch !== 'HEAD') {
      await git.raw([
        'fetch',
        '--prune',
        this.tokenizedUrl(gallery),
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ]);
    }
    return this.readStatus(git);
  }

  private async readStatus(
    git: SimpleGit
  ): Promise<{ current: string; ahead: number; behind: number; dirty: boolean }> {
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
