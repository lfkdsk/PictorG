'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  getPicgBridge,
  listRepos,
  type CloneProgress,
  type LocalGallery,
  type PicgBridge,
  type Repo,
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
  const [bridge, setBridge] = useState<PicgBridge | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [galleries, setGalleries] = useState<LocalGallery[]>([]);
  const [cloning, setCloning] = useState<
    Record<string, { repo: Repo; progress?: CloneProgress; error?: string }>
  >({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setBridge(getPicgBridge());
    setToken(getGitHubToken());
  }, []);

  useEffect(() => {
    if (!bridge) return;
    bridge.gallery.list().then(setGalleries).catch((err) => setError(String(err)));
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.gallery.onCloneProgress((evt) => {
      setCloning((prev) => {
        const entry = prev[evt.galleryId];
        if (!entry) return prev;
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
    setCloning((prev) => ({ ...prev, [id]: { repo } }));
    setError(null);

    try {
      await bridge.gallery.clone({
        owner,
        repo: name,
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        cloneUrl: cloneUrlFor(repo.full_name),
        token,
      });
      const fresh = await bridge.gallery.list();
      setGalleries(fresh);
    } catch (err) {
      setCloning((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          error: err instanceof Error ? err.message : String(err),
        },
      }));
      return;
    }
    setCloning((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
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
          <Link href="/login/token" className="btn primary inline">
            Open token sign-in →
          </Link>
        </main>
        <DesktopTheme />
        <style jsx>{`
          .empty { padding: 96px 32px; max-width: 560px; margin: 0 auto; }
          .empty h1 { font-family: var(--serif); font-size: 56px; font-weight: 400; margin: 0 0 12px; letter-spacing: -0.01em; }
          .empty p { color: var(--text-muted); font-size: 15px; margin: 0 0 24px; }
          .btn.inline { display: inline-block; }
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
        </section>

        <div className="actions-row">
          <button className="btn primary" onClick={openPicker}>+ Add gallery</button>
        </div>

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
                <div className="card-title">{entry.repo.full_name}</div>
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
                  </>
                )}
              </li>
            );
          })}

          {galleries.map((g) => (
            <li key={g.id} className="card">
              <Link href={`/desktop/galleries/${g.id}`} className="card-title-link">
                <div className="card-title">{g.fullName}</div>
              </Link>
              <div className="card-meta">
                <span>{formatBytes(g.sizeBytes)}</span>
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
              <div className="card-actions">
                <button onClick={() => handleSync(g.id)} className="btn ghost small">Sync</button>
                <button onClick={() => handleRemove(g.id)} className="btn ghost small">Remove</button>
              </div>
            </li>
          ))}

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

        .actions-row { margin-bottom: 24px; }

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

        .card-title-link { text-decoration: none; color: inherit; }
        .card-title {
          font-family: var(--serif);
          font-size: 22px;
          font-weight: 400;
          letter-spacing: -0.01em;
          color: var(--text);
        }
        .card-title-link:hover .card-title { color: var(--accent); }

        .card-meta {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-muted);
          display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
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

