'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type DirectoryEntry,
  type LocalGallery,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';

const TEST_FILE = '.picg-desktop-spike.txt';

function formatBytes(n?: number): string {
  if (!n || n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
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

export default function GalleryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(null);
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [log, setLog] = useState<{ time: string; line: string; kind: 'ok' | 'err' }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBridge(getPicgBridge());
  }, []);

  useEffect(() => {
    if (!bridge || !id) return;
    bridge.gallery.resolve(id).then((g) => {
      setGallery(g);
      if (g) {
        setAdapter(
          new PreloadBridgeAdapter({ repoPath: g.localPath, bridge: bridge.storage })
        );
      }
    });
  }, [bridge, id]);

  useEffect(() => {
    if (!adapter) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  function logLine(line: string, kind: 'ok' | 'err' = 'ok') {
    setLog((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString(), line, kind },
    ]);
  }

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (!adapter || busy) return;
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      logLine(err instanceof Error ? err.message : String(err), 'err');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    await withBusy(async () => {
      const branch = await adapter!.getDefaultBranch();
      setDefaultBranch(branch);
      const dir = await adapter!.listDirectory('');
      setEntries(dir);
      logLine(`branch=${branch}, ${dir.length} entries in root`);
    });
  }

  async function readReadme() {
    await withBusy(async () => {
      const file = await adapter!.readFile('README.yml');
      const preview = file.text().slice(0, 200);
      logLine(`README.yml: ${file.data.length} bytes, sha=${file.sha.slice(0, 8)}`);
      logLine(preview.replace(/\n/g, ' / '));
    });
  }

  async function writeTestFile() {
    await withBusy(async () => {
      const stamp = new Date().toISOString();
      await adapter!.writeFile(
        TEST_FILE,
        `desktop spike\n${stamp}\n`,
        `chore(spike): write ${TEST_FILE} ${stamp}`
      );
      logLine(`wrote ${TEST_FILE} (committed locally)`);
      const meta = await adapter!.readFileMetadata(TEST_FILE);
      logLine(`metadata: sha=${meta?.sha.slice(0, 8)}, size=${meta?.size}`);
      const dir = await adapter!.listDirectory('');
      setEntries(dir);
    });
  }

  async function deleteTestFile() {
    await withBusy(async () => {
      await adapter!.deleteFile(TEST_FILE, `chore(spike): clean ${TEST_FILE}`);
      logLine(`deleted ${TEST_FILE} (committed locally)`);
      const dir = await adapter!.listDirectory('');
      setEntries(dir);
    });
  }

  if (!bridge) {
    return (
      <div className="page">
        <main className="empty">
          <h1>Desktop only</h1>
        </main>
        <DesktopTheme />
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className="page">
        <Topbar />
        <main className="loading">
          <p>Loading…</p>
        </main>
        <DesktopTheme />
        <style jsx>{`
          .loading { padding: 96px; text-align: center; color: var(--text-muted);
                     font-family: var(--mono); font-size: 13px;
                     letter-spacing: 0.05em; text-transform: uppercase; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href="/desktop/galleries" className="back-link">
          ← All galleries
        </Link>

        <section className="hero">
          <h1>{gallery.fullName}</h1>
          <p className="meta">
            {defaultBranch && <><span>{defaultBranch}</span><span className="dot">•</span></>}
            <span>{formatBytes(gallery.sizeBytes)}</span>
            <span className="dot">•</span>
            <span>{entries.length} root entries</span>
            {gallery.lastSyncAt && (
              <>
                <span className="dot">•</span>
                <span>synced {formatRelativeTime(gallery.lastSyncAt)}</span>
              </>
            )}
          </p>
          <p className="path"><code>{gallery.localPath}</code></p>
        </section>

        <section className="block">
          <h2>Smoke test</h2>
          <p className="hint">
            End-to-end check of the StorageAdapter pipeline. Operations commit
            to the local clone; auto-push is off unless <code>PICG_AUTOPUSH=1</code>.
          </p>
          <div className="actions">
            <button className="btn primary" onClick={refresh} disabled={busy}>Refresh listing</button>
            <button className="btn ghost" onClick={readReadme} disabled={busy}>Read README.yml</button>
            <button className="btn ghost" onClick={writeTestFile} disabled={busy}>Write test file</button>
            <button className="btn ghost" onClick={deleteTestFile} disabled={busy}>Delete test file</button>
          </div>
        </section>

        <section className="block">
          <h2>Root listing</h2>
          <ul className="entries">
            {entries.map((e) => (
              <li key={e.path}>
                <span className="entry-icon">{e.type === 'dir' ? '▸' : ' '}</span>
                <span>{e.name}</span>
                <span className="entry-size">{e.size ? formatBytes(e.size) : ''}</span>
              </li>
            ))}
            {entries.length === 0 && <li className="empty-row">empty</li>}
          </ul>
        </section>

        <section className="block">
          <h2>Log</h2>
          <pre className="log">
            {log.length === 0 && <span className="muted">no events yet</span>}
            {log.map((entry, i) => (
              <div key={i} className={entry.kind}>
                <span className="time">[{entry.time}]</span> {entry.line}
              </div>
            ))}
          </pre>
        </section>
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1100px; margin: 0 auto; }

        .back-link {
          display: inline-block;
          margin-bottom: 24px;
          color: var(--text-muted);
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          text-decoration: none;
          transition: color 0.15s ease;
        }
        .back-link:hover { color: var(--accent); }

        .hero { margin-bottom: 40px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 48px;
          font-weight: 400;
          letter-spacing: -0.01em;
          margin: 0 0 10px;
          color: var(--text);
          line-height: 1.1;
        }
        .meta {
          margin: 0 0 8px;
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
          display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
        }
        .dot { color: var(--text-faint); }
        .path { margin: 0; }
        .path code {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-faint);
          background: transparent;
          padding: 0;
        }

        .block { margin-bottom: 32px; }
        .block h2 {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 500;
          margin: 0 0 12px;
        }
        .hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 14px;
          max-width: 720px;
          line-height: 1.5;
        }
        .hint code {
          font-family: var(--mono);
          font-size: 12px;
          background: var(--bg-card);
          color: var(--text);
          padding: 2px 6px;
          border-radius: 4px;
        }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; }

        .entries {
          list-style: none; padding: 12px; margin: 0;
          display: flex; flex-direction: column; gap: 1px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .entries li {
          display: flex; gap: 12px;
          padding: 6px 10px;
          font-family: var(--mono);
          font-size: 13px;
          color: var(--text);
          border-radius: 6px;
        }
        .entries li:hover { background: var(--bg-card-hover); }
        .entry-icon {
          width: 14px;
          color: var(--accent);
        }
        .entry-size {
          margin-left: auto;
          color: var(--text-faint);
          font-size: 11px;
          letter-spacing: 0.04em;
        }
        .empty-row { color: var(--text-faint); font-style: italic; }
        .empty-row:hover { background: transparent; }

        .log {
          background: #0a0806;
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 14px 16px;
          font-family: var(--mono);
          font-size: 12px;
          line-height: 1.6;
          max-height: 320px;
          overflow-y: auto;
          margin: 0;
        }
        .log :global(.err) { color: #f0857b; }
        .log :global(.muted) { color: var(--text-faint); font-style: italic; }
        .log :global(.time) { color: var(--text-faint); margin-right: 6px; }
      `}</style>
    </div>
  );
}

