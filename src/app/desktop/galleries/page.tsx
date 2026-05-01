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
      return 'Receiving objects';
    case 'resolving':
      return 'Resolving deltas';
    case 'compressing':
      return 'Compressing';
    case 'writing':
      return 'Writing';
    default:
      return 'Working';
  }
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

  // Initial gallery load.
  useEffect(() => {
    if (!bridge) return;
    bridge.gallery.list().then(setGalleries).catch((err) => setError(String(err)));
  }, [bridge]);

  // Subscribe to clone-progress events so cards can show real-time progress.
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
      // Leave the error card visible until the user dismisses it.
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
      <main className="empty">
        <h1>Desktop only</h1>
        <p>This page only works inside the PicG desktop app. Run <code>npm run electron:dev</code> to launch.</p>
        <style jsx>{`
          .empty { padding: 48px; max-width: 640px; margin: 0 auto; }
          code { background: #f3f3f3; padding: 2px 6px; border-radius: 4px; }
        `}</style>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="empty">
        <h1>Sign in</h1>
        <p>Sign in to GitHub to add galleries.</p>
        <Link href="/login/token">→ Open token login</Link>
        <style jsx>{`
          .empty { padding: 48px; max-width: 640px; margin: 0 auto; }
        `}</style>
      </main>
    );
  }

  const filteredRepos = repos?.filter((r) =>
    r.full_name.toLowerCase().includes(filter.toLowerCase())
  );
  const cloningEntries = Object.entries(cloning);

  return (
    <main>
      <header>
        <h1>My galleries</h1>
        <button className="primary" onClick={openPicker}>+ Add gallery</button>
      </header>

      {error && (
        <div className="banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <ul className="grid">
        {cloningEntries.map(([id, entry]) => {
          const pct = entry.progress?.percent ?? 0;
          return (
            <li key={`cloning:${id}`} className="card cloning">
              <div className="title">{entry.repo.full_name}</div>
              {entry.error ? (
                <>
                  <div className="error-text">{entry.error}</div>
                  <button onClick={() => dismissError(id)}>dismiss</button>
                </>
              ) : (
                <>
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="meta">
                    {stageLabel(entry.progress?.stage ?? 'other')} · {pct.toFixed(0)}%
                    {entry.progress?.processed && entry.progress?.total
                      ? ` (${entry.progress.processed}/${entry.progress.total})`
                      : null}
                  </div>
                </>
              )}
            </li>
          );
        })}

        {galleries.map((g) => (
          <li key={g.id} className="card">
            <div className="title">
              <Link href={`/desktop/galleries/${g.id}`}>{g.fullName}</Link>
            </div>
            <div className="meta">
              <span>{formatBytes(g.sizeBytes)}</span>
              {g.defaultBranch && <span> · {g.defaultBranch}</span>}
              {g.lastSyncAt && <span> · synced {new Date(g.lastSyncAt).toLocaleString()}</span>}
            </div>
            <div className="actions">
              <button onClick={() => handleSync(g.id)}>Sync</button>
              <button onClick={() => handleRemove(g.id)}>Remove</button>
            </div>
          </li>
        ))}

        {!cloningEntries.length && !galleries.length && (
          <li className="empty-state">
            <p>No galleries yet. Click <strong>+ Add gallery</strong> to clone one from your GitHub.</p>
          </li>
        )}
      </ul>

      {pickerOpen && (
        <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2>Choose a repo to clone</h2>
              <button onClick={() => setPickerOpen(false)}>✕</button>
            </header>
            <input
              className="filter"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            <div className="repo-list">
              {loadingRepos && <div className="loading">Loading your repos…</div>}
              {filteredRepos?.map((r) => {
                const id = r.full_name.replace('/', '__');
                const alreadyManaged = galleries.some((g) => g.id === id);
                const inFlight = !!cloning[id];
                return (
                  <button
                    key={r.id}
                    className="repo-item"
                    disabled={alreadyManaged || inFlight}
                    onClick={() => pickRepo(r)}
                  >
                    <span>{r.full_name}</span>
                    {r.private && <span className="badge">private</span>}
                    {alreadyManaged && <span className="badge muted">added</span>}
                  </button>
                );
              })}
              {filteredRepos?.length === 0 && <div className="loading">No matches.</div>}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        main { padding: 32px; max-width: 1100px; margin: 0 auto; }
        header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        h1 { margin: 0; }
        .primary {
          background: #0969da; color: white; border: 0; padding: 8px 14px;
          border-radius: 6px; cursor: pointer; font-weight: 600;
        }
        .banner {
          background: #ffebe9; border: 1px solid #f1aeb5; padding: 8px 12px;
          border-radius: 6px; margin-bottom: 16px; display: flex; gap: 12px; align-items: center;
        }
        .banner button { margin-left: auto; }
        .grid { list-style: none; padding: 0; display: grid; gap: 12px;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
        .card {
          border: 1px solid #d0d7de; border-radius: 8px; padding: 14px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .card.cloning { background: #f6f8fa; }
        .title { font-weight: 600; font-size: 15px; }
        .title :global(a) { color: #0969da; text-decoration: none; }
        .title :global(a:hover) { text-decoration: underline; }
        .meta { color: #57606a; font-size: 12px; }
        .actions { display: flex; gap: 8px; margin-top: 4px; }
        .actions button { padding: 4px 10px; font-size: 12px; cursor: pointer;
          border: 1px solid #d0d7de; background: white; border-radius: 6px; }
        .empty-state { grid-column: 1 / -1; padding: 32px; text-align: center;
          color: #57606a; border: 1px dashed #d0d7de; border-radius: 8px; }
        .bar { height: 6px; background: #d0d7de; border-radius: 3px; overflow: hidden; }
        .bar-fill { height: 100%; background: #0969da; transition: width 0.2s; }
        .error-text { color: #cf222e; font-size: 12px; }

        .modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center; z-index: 100;
        }
        .modal {
          background: white; border-radius: 10px; padding: 16px;
          width: 480px; max-height: 70vh; display: flex; flex-direction: column;
        }
        .modal-header { display: flex; justify-content: space-between;
          align-items: center; margin-bottom: 12px; }
        .modal-header h2 { margin: 0; font-size: 16px; }
        .modal-header button { background: none; border: 0; font-size: 18px;
          cursor: pointer; color: #57606a; }
        .filter { width: 100%; padding: 8px 10px; border: 1px solid #d0d7de;
          border-radius: 6px; margin-bottom: 12px; box-sizing: border-box; }
        .repo-list { overflow-y: auto; display: flex; flex-direction: column;
          gap: 4px; }
        .repo-item { display: flex; gap: 8px; align-items: center; padding: 8px 10px;
          border: 0; background: white; cursor: pointer; text-align: left;
          border-radius: 6px; }
        .repo-item:hover:not(:disabled) { background: #f6f8fa; }
        .repo-item:disabled { color: #8c959f; cursor: not-allowed; }
        .badge {
          margin-left: auto; padding: 1px 6px; font-size: 10px;
          background: #ddf4ff; color: #0969da; border-radius: 10px;
        }
        .badge.muted { background: #eaeef2; color: #57606a; }
        .loading { padding: 16px; text-align: center; color: #57606a; }
      `}</style>
    </main>
  );
}
