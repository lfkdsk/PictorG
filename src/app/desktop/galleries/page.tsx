'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import {
  CLONE_CANCELLED_MESSAGE,
  getPicgBridge,
  listRepos,
  type CloneProgress,
  type LocalGallery,
  type PicgBridge,
  type Repo,
} from '@/core/storage';
import type {
  InFlightClone,
  MigrateDirection,
  MigrateProgress,
} from '@/core/storage';
import { getGitHubToken } from '@/lib/github';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';

function formatBytes(n?: number): string {
  if (!n || n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function stageLabel(stage: CloneProgress['stage']): string {
  switch (stage) {
    case 'receiving':
      return 'receiving objects';
    case 'resolving':
      return 'resolving deltas';
    case 'compressing':
      return 'compressing';
    case 'writing':
      return 'writing';
    default:
      return 'working';
  }
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function cloneUrlFor(fullName: string): string {
  return `https://github.com/${fullName}.git`;
}

export default function GalleriesPage() {
  // Lazy init reads window.picgBridge synchronously on first render so
  // SPA navigations don't flash the "Desktop only" gate while a useEffect
  // catches up. SSR returns null (no window), which still produces a
  // brief flash on the very first cold load — that's a one-time hit.
  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [token, setToken] = useState<string | null>(null);
  const [galleries, setGalleries] = useState<LocalGallery[]>([]);
  // Cloning state is intentionally a minimal shape — fullName is enough
  // for the card title, the rest of the Repo metadata isn't read here.
  // Keeping it loose lets us bootstrap an entry from either a user-driven
  // pickRepo() call OR a CloneProgress event whose galleryId we don't
  // yet know about (e.g. user navigated away mid-clone and came back).
  const [cloning, setCloning] = useState<
    Record<
      string,
      { fullName: string; htmlUrl?: string; progress?: CloneProgress; error?: string }
    >
  >({});
  // In-flight migrations keyed by galleryId. We render the card's
  // action row as a progress bar + phase label while present, and
  // restore the normal Sync / Move / Remove row once the entry is
  // cleared (on success or after the user dismisses an error).
  const [migrating, setMigrating] = useState<
    Record<string, { direction: MigrateDirection; progress?: MigrateProgress; error?: string }>
  >({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Galleries the user just cancelled. Used to (1) suppress late-arriving
  // CloneProgress events that would otherwise re-bootstrap a card the
  // user dismissed, and (2) silence the pickRepo() catch when its clone
  // promise rejects with the cancellation marker. Lives in a ref so the
  // progress listener and async catch read the freshest set.
  const cancelledIdsRef = useRef(new Set<string>());

  useEffect(() => {
    // Re-read after hydration so SSR's null doesn't stick. Cheap.
    setBridge(getPicgBridge());
    setToken(getGitHubToken());
  }, []);

  useEffect(() => {
    if (!bridge) return;
    bridge.gallery.list().then(setGalleries).catch((err) => setError(String(err)));
    // Also fetch any clones currently running in main. The renderer's
    // useState is local to the page instance, so navigating away while
    // a clone is in progress strands the UI even though main keeps
    // working. listInFlight() lets us rebuild the progress cards on
    // remount; subsequent progress events will then update them.
    bridge.gallery
      .listInFlight()
      .then((inFlight: InFlightClone[]) => {
        if (inFlight.length === 0) return;
        setCloning((prev) => {
          const next = { ...prev };
          for (const item of inFlight) {
            // Don't clobber a fresher entry the user just added in this
            // session — only seed ids we don't already know about.
            if (next[item.galleryId]) continue;
            next[item.galleryId] = {
              fullName: item.fullName,
              htmlUrl: item.htmlUrl,
              progress: item.lastProgress,
            };
          }
          return next;
        });
      })
      .catch(() => {
        /* listInFlight is a best-effort UI nicety; failure is non-fatal */
      });
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.gallery.onCloneProgress((evt) => {
      // Belt-and-suspenders against post-cancel ticks. Main also drops
      // events once the AbortSignal fires, but if the renderer cancels
      // and a stray event slips through we don't want to bootstrap a
      // fresh card from it via the no-prior-entry branch below.
      if (cancelledIdsRef.current.has(evt.galleryId)) return;
      setCloning((prev) => {
        const entry = prev[evt.galleryId];
        if (entry) {
          return { ...prev, [evt.galleryId]: { ...entry, progress: evt } };
        }
        // No prior entry means the page mounted after a clone was
        // already running and the listInFlight() seed hasn't landed
        // yet (or the clone was started in another window). The event
        // carries enough metadata to bootstrap a card on its own.
        if (!evt.fullName) return prev;
        return {
          ...prev,
          [evt.galleryId]: {
            fullName: evt.fullName,
            htmlUrl: evt.htmlUrl,
            progress: evt,
          },
        };
      });
    });
    return unsub;
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.gallery.onMigrateProgress((evt) => {
      // Migration is now triggered from the gallery detail page, but we
      // still listen here so a user navigating back mid-flight can see
      // progress on the card. On terminal phases, refetch the manifest
      // so the storage badge / size flip to the post-migration state,
      // and clear the in-flight entry so the card stops showing "100%
      // moving to iCloud" indefinitely.
      if (evt.phase === 'done' || evt.phase === 'error') {
        bridge.gallery
          .list()
          .then((fresh) => setGalleries(fresh))
          .catch(() => {});
        setMigrating((prev) => {
          const { [evt.galleryId]: _removed, ...rest } = prev;
          return rest;
        });
        return;
      }
      setMigrating((prev) => {
        const entry = prev[evt.galleryId] ?? { direction: evt.direction };
        return { ...prev, [evt.galleryId]: { ...entry, progress: evt } };
      });
    });
    return unsub;
  }, [bridge]);

  async function openPicker() {
    if (!token) {
      setError('Sign in to GitHub first.');
      return;
    }
    setPickerOpen(true);
    if (!repos) {
      setLoadingRepos(true);
      try {
        const r = await listRepos(token);
        setRepos(r);
      } catch (err) {
        setError(`Failed to load repos: ${err instanceof Error ? err.message : err}`);
      } finally {
        setLoadingRepos(false);
      }
    }
  }

  async function pickRepo(repo: Repo) {
    if (!bridge || !token) return;
    setPickerOpen(false);
    const [owner, name] = repo.full_name.split('/');
    const id = `${owner}__${name}`;
    setCloning((prev) => ({
      ...prev,
      [id]: { fullName: repo.full_name, htmlUrl: repo.html_url },
    }));
    setError(null);

    try {
      await bridge.gallery.clone({
        owner,
        repo: name,
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        cloneUrl: cloneUrlFor(repo.full_name),
      });
      const fresh = await bridge.gallery.list();
      setGalleries(fresh);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // User-initiated cancel — handleCancelClone already removed the
      // card. Just clear the marker so a future re-clone of the same
      // repo isn't permanently muted.
      if (
        cancelledIdsRef.current.has(id) ||
        message.includes(CLONE_CANCELLED_MESSAGE)
      ) {
        cancelledIdsRef.current.delete(id);
        return;
      }
      setCloning((prev) => ({
        ...prev,
        [id]: { ...prev[id], error: message },
      }));
      return;
    }
    setCloning((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }

  async function handleCancelClone(id: string) {
    if (!bridge) return;
    // Mark first so any in-flight progress event is dropped before we
    // touch state, and so the pickRepo() catch knows this rejection is
    // a cancel rather than a real failure.
    cancelledIdsRef.current.add(id);
    setCloning((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      await bridge.gallery.cancelClone(id);
    } catch {
      /* idempotent on the main side; nothing to surface */
    }
  }

  async function handleSync(id: string) {
    if (!bridge) return;
    try {
      const updated = await bridge.gallery.sync(id);
      setGalleries((prev) => prev.map((g) => (g.id === id ? updated : g)));
    } catch (err) {
      setError(`Sync failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function handleRemove(id: string) {
    if (!bridge) return;
    if (!confirm('Remove this gallery from the desktop app? Local files will be deleted.')) return;
    try {
      await bridge.gallery.remove(id);
      setGalleries((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      setError(`Remove failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function handleMigrate(id: string, direction: MigrateDirection) {
    if (!bridge) return;
    const isToICloud = direction === 'to-icloud';
    const confirmText = isToICloud
      ? 'Move this gallery into your iCloud Drive? It will sync to your other Macs automatically.'
      : 'Move this gallery out of iCloud back to local-only storage on this Mac?';
    if (!confirm(confirmText)) return;

    setMigrating((prev) => ({ ...prev, [id]: { direction } }));
    try {
      const updated = await bridge.gallery.migrate(id, direction);
      setGalleries((prev) => prev.map((g) => (g.id === id ? updated : g)));
      // Clear the migrating entry on success — the renderer will
      // immediately render the post-migration state (new badge,
      // restored Sync / Move / Remove row).
      setMigrating((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      // Leave the entry in place with an error; the user dismisses
      // it explicitly so they have time to read what failed (network,
      // disk space, destination already exists, …).
      setMigrating((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          direction,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }

  function dismissMigrate(id: string) {
    setMigrating((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function dismissError(id: string) {
    setCloning((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }

  if (!bridge) {
    return (
      <div className="page">
        <main className="empty">
          <h1>Desktop only</h1>
          <p>
            This page lives in the PicG desktop app. Run{' '}
            <code>npm run electron:dev</code> from the worktree to open it.
          </p>
        </main>
        <DesktopTheme />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="page">
        <Topbar />
        <main className="empty">
          <h1>Sign in</h1>
          <p>Connect your GitHub account to start adding galleries.</p>
          <Link href="/desktop/login" className="btn primary">
            Sign in with GitHub →
          </Link>
        </main>
        <DesktopTheme />
        <style jsx>{`
          .empty { padding: 96px 32px; max-width: 560px; margin: 0 auto; }
          .empty h1 { font-family: var(--serif); font-size: 56px; font-weight: 400; margin: 0 0 12px; letter-spacing: -0.01em; }
          .empty p { color: var(--text-muted); font-size: 15px; margin: 0 0 24px; }
        `}</style>
      </div>
    );
  }

  const filteredRepos = repos?.filter((r) =>
    r.full_name.toLowerCase().includes(filter.toLowerCase())
  );
  const cloningEntries = Object.entries(cloning);
  const totalSize = galleries.reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0);

  return (
    <div className="page">
      <Topbar />

      <main>
        <section className="hero">
          <div className="hero-row">
            <div>
              <h1>My galleries</h1>
              <p className="meta">
                <span>{galleries.length} managed</span>
                <span className="dot">•</span>
                <span>{formatBytes(totalSize)} on disk</span>
                {cloningEntries.length > 0 && (
                  <>
                    <span className="dot">•</span>
                    <span>{cloningEntries.length} cloning</span>
                  </>
                )}
              </p>
            </div>
            <div className="hero-actions">
              <button className="btn primary" onClick={openPicker}>
                + Add gallery
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="banner">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="dismiss">dismiss</button>
          </div>
        )}

        <ul className="grid">
          {cloningEntries.map(([id, entry]) => {
            const pct = entry.progress?.percent ?? 0;
            const stage = entry.progress?.stage ?? 'other';
            return (
              <li key={`cloning:${id}`} className="card cloning">
                <div className="card-title">{entry.fullName}</div>
                {entry.error ? (
                  <>
                    <div className="error-text">{entry.error}</div>
                    <button onClick={() => dismissError(id)} className="btn ghost small">
                      dismiss
                    </button>
                  </>
                ) : (
                  <>
                    <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                    <div className="card-meta">
                      <span>{stageLabel(stage)}</span>
                      <span className="dot">•</span>
                      <span>{pct.toFixed(0)}%</span>
                      {entry.progress?.processed && entry.progress?.total && (
                        <>
                          <span className="dot">•</span>
                          <span>{entry.progress.processed.toLocaleString()}/{entry.progress.total.toLocaleString()}</span>
                        </>
                      )}
                    </div>
                    <div className="card-actions">
                      <button
                        onClick={() => handleCancelClone(id)}
                        className="btn ghost small"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}

          {galleries.map((g) => {
            const m = migrating[g.id];
            const phase = m?.progress?.phase;
            const phaseLabel = phase
              ? phase === 'counting'
                ? 'preparing'
                : phase === 'copying'
                ? 'copying files'
                : phase === 'verifying'
                ? 'verifying'
                : phase === 'cleanup'
                ? 'cleaning up'
                : phase
              : 'starting…';
            const processed = m?.progress?.processed ?? 0;
            const totalFiles = m?.progress?.total ?? 0;
            const pct = totalFiles > 0 ? Math.min(100, (processed / totalFiles) * 100) : 0;
            return (
              <li key={g.id} className="card">
                <Link href={`/desktop/galleries/${g.id}`} className="picg-card-link">
                  <div className="card-title">{g.fullName}</div>
                </Link>
                <div className="card-meta">
                  <span>{formatBytes(g.sizeBytes)}</span>
                  <span className="dot">•</span>
                  <span className={`storage-tag ${g.storage ?? 'internal'}`}>
                    {g.storage === 'icloud' ? 'iCloud' : 'Internal'}
                  </span>
                  {g.defaultBranch && (
                    <>
                      <span className="dot">•</span>
                      <span>{g.defaultBranch}</span>
                    </>
                  )}
                  {g.lastSyncAt && (
                    <>
                      <span className="dot">•</span>
                      <span>synced {formatRelativeTime(g.lastSyncAt)}</span>
                    </>
                  )}
                </div>
                {m ? (
                  m.error ? (
                    <>
                      <div className="error-text">{m.error}</div>
                      <div className="card-actions">
                        <button onClick={() => dismissMigrate(g.id)} className="btn ghost small">
                          dismiss
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="card-meta">
                        <span>
                          {m.direction === 'to-icloud' ? 'moving to iCloud' : 'moving to internal'}
                        </span>
                        <span className="dot">•</span>
                        <span>{phaseLabel}</span>
                        {totalFiles > 0 && (
                          <>
                            <span className="dot">•</span>
                            <span>
                              {processed.toLocaleString()}/{totalFiles.toLocaleString()} files
                            </span>
                          </>
                        )}
                      </div>
                    </>
                  )
                ) : (
                  <div className="card-actions">
                    <button onClick={() => handleSync(g.id)} className="btn ghost small">Sync</button>
                    <button onClick={() => handleRemove(g.id)} className="btn ghost small">Remove</button>
                  </div>
                )}
              </li>
            );
          })}

          {!cloningEntries.length && !galleries.length && (
            <li className="empty-state">
              <p>No galleries yet.</p>
              <p className="hint">Click <strong>+ Add gallery</strong> to clone one from your GitHub.</p>
            </li>
          )}
        </ul>
      </main>

      {pickerOpen && (
        <div className="picg-modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="picg-modal" onClick={(e) => e.stopPropagation()}>
            <header className="picg-modal-header">
              <h2>Choose a repo to clone</h2>
              <button onClick={() => setPickerOpen(false)} className="btn ghost icon">✕</button>
            </header>
            <input
              className="picg-modal-filter"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            <div className="picg-repo-list">
              {loadingRepos && <div className="picg-modal-loading">Loading your repos…</div>}
              {filteredRepos?.map((r) => {
                const id = r.full_name.replace('/', '__');
                const alreadyManaged = galleries.some((g) => g.id === id);
                const inFlight = !!cloning[id];
                return (
                  <button
                    key={r.id}
                    className="picg-repo-item"
                    disabled={alreadyManaged || inFlight}
                    onClick={() => pickRepo(r)}
                  >
                    <span className="picg-repo-name">{r.full_name}</span>
                    <span className="picg-repo-tags">
                      {r.private && <span className="picg-badge">private</span>}
                      {alreadyManaged && <span className="picg-badge muted">added</span>}
                    </span>
                  </button>
                );
              })}
              {!loadingRepos && filteredRepos?.length === 0 && (
                <div className="picg-modal-loading">No matches.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <DesktopTheme />
      <style jsx>{`
        main { padding: 32px 40px 64px; max-width: 1100px; margin: 0 auto; }

        .hero { margin-bottom: 32px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 56px;
          font-weight: 400;
          letter-spacing: -0.01em;
          margin: 0 0 8px;
          color: var(--text);
        }
        .meta {
          margin: 0;
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
          display: flex; gap: 8px; align-items: center;
        }
        .dot { color: var(--text-faint); }

        .hero-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }
        .hero-actions {
          display: flex; gap: 8px; align-items: center; flex-shrink: 0;
        }

        .banner {
          background: rgba(216, 90, 70, 0.12);
          border: 1px solid rgba(216, 90, 70, 0.32);
          color: #f0bfb6;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          display: flex; gap: 12px; align-items: center;
          font-size: 13px;
        }
        .banner .dismiss {
          margin-left: auto;
          background: none; border: 0; cursor: pointer;
          color: inherit; font-family: var(--mono); font-size: 12px;
          text-transform: uppercase; letter-spacing: 0.05em;
        }

        .grid {
          list-style: none; padding: 0; margin: 0;
          display: grid; gap: 14px;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        }

        .card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 20px;
          display: flex; flex-direction: column; gap: 10px;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .card:hover { border-color: var(--border-strong); }
        .card.cloning { background: var(--bg-card-warm); }

        .card-title {
          font-family: var(--serif);
          font-size: 22px;
          font-weight: 400;
          letter-spacing: -0.01em;
          color: var(--text);
        }

        .card-meta {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-muted);
          display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
        }
        .storage-tag.icloud {
          color: var(--accent);
        }

        .card-actions { display: flex; gap: 8px; margin-top: 4px; }

        .bar {
          height: 4px;
          background: rgba(232, 220, 196, 0.08);
          border-radius: 2px;
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: var(--accent);
          transition: width 0.2s ease;
        }
        .error-text {
          color: #f0bfb6;
          font-size: 13px;
          font-family: var(--mono);
        }

        .empty-state {
          grid-column: 1 / -1;
          padding: 56px 24px;
          text-align: center;
          color: var(--text-muted);
          border: 1px dashed var(--border-strong);
          border-radius: 14px;
        }
        .empty-state p { margin: 0; }
        .empty-state p + p { margin-top: 8px; }
        .empty-state .hint { font-family: var(--mono); font-size: 12px;
          letter-spacing: 0.04em; text-transform: uppercase; }
        .empty-state strong { color: var(--text); font-weight: 600; }

      `}</style>
    </div>
  );
}

