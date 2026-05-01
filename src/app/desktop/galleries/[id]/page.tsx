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

const TEST_FILE = '.picg-desktop-spike.txt';

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

  // Auto-load branch + root listing once the adapter is wired up.
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
      logLine(`Branch=${branch}, ${dir.length} entries in root`);
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
      logLine(`Wrote ${TEST_FILE} (committed locally)`);
      const meta = await adapter!.readFileMetadata(TEST_FILE);
      logLine(`metadata: sha=${meta?.sha.slice(0, 8)}, size=${meta?.size}`);
      const dir = await adapter!.listDirectory('');
      setEntries(dir);
    });
  }

  async function deleteTestFile() {
    await withBusy(async () => {
      await adapter!.deleteFile(TEST_FILE, `chore(spike): clean ${TEST_FILE}`);
      logLine(`Deleted ${TEST_FILE} (committed locally)`);
      const dir = await adapter!.listDirectory('');
      setEntries(dir);
    });
  }

  if (!bridge) {
    return (
      <main className="empty">
        <p>Desktop only.</p>
        <style jsx>{`.empty { padding: 48px; }`}</style>
      </main>
    );
  }

  if (!gallery) {
    return (
      <main className="empty">
        <p>Loading…</p>
        <style jsx>{`.empty { padding: 48px; }`}</style>
      </main>
    );
  }

  return (
    <main>
      <nav className="crumbs">
        <Link href="/desktop/galleries">← All galleries</Link>
      </nav>
      <header>
        <h1>{gallery.fullName}</h1>
        <p className="path"><code>{gallery.localPath}</code></p>
        <p className="meta">
          {defaultBranch ?? '?'} · {entries.length} root entries
          {gallery.lastSyncAt && ` · synced ${new Date(gallery.lastSyncAt).toLocaleString()}`}
        </p>
      </header>

      <section>
        <h2>Smoke test</h2>
        <p className="hint">
          End-to-end check of <code>PreloadBridgeAdapter → IPC → LocalGitStorageAdapter</code>.
          Operations commit to the local clone (auto-push is off by default; set
          <code> PICG_AUTOPUSH=1</code> to also push).
        </p>
        <div className="actions">
          <button onClick={refresh} disabled={busy}>Refresh listing</button>
          <button onClick={readReadme} disabled={busy}>Read README.yml</button>
          <button onClick={writeTestFile} disabled={busy}>Write test file</button>
          <button onClick={deleteTestFile} disabled={busy}>Delete test file</button>
        </div>
      </section>

      <section>
        <h2>Root listing</h2>
        <ul className="entries">
          {entries.map((e) => (
            <li key={e.path}>
              <span className={`type ${e.type}`}>{e.type === 'dir' ? '📁' : '📄'}</span>
              <span>{e.name}</span>
            </li>
          ))}
          {entries.length === 0 && <li className="empty-row">empty</li>}
        </ul>
      </section>

      <section>
        <h2>Log</h2>
        <pre className="log">
          {log.length === 0 && <span className="muted">no events yet</span>}
          {log.map((entry, i) => (
            <div key={i} className={entry.kind}>
              [{entry.time}] {entry.line}
            </div>
          ))}
        </pre>
      </section>

      <style jsx>{`
        main { padding: 24px 32px; max-width: 900px; margin: 0 auto; }
        .crumbs { margin-bottom: 16px; }
        .crumbs :global(a) { color: #0969da; text-decoration: none; font-size: 13px; }
        h1 { margin: 0 0 4px; }
        h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em;
             color: #57606a; margin: 24px 0 8px; }
        .path code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px;
                     font-size: 12px; color: #57606a; }
        .meta { color: #57606a; font-size: 12px; margin: 4px 0 0; }
        .hint { color: #57606a; font-size: 13px; max-width: 720px; }
        .hint code { background: #f6f8fa; padding: 1px 4px; border-radius: 3px; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .actions button {
          padding: 6px 12px; border: 1px solid #d0d7de; background: white;
          border-radius: 6px; cursor: pointer; font-size: 13px;
        }
        .actions button:disabled { opacity: 0.5; cursor: wait; }
        .actions button:hover:not(:disabled) { background: #f6f8fa; }
        .entries { list-style: none; padding: 0; display: flex; flex-direction: column;
                   gap: 2px; border: 1px solid #d0d7de; border-radius: 6px; padding: 8px; }
        .entries li { display: flex; gap: 8px; padding: 4px 8px; font-size: 13px;
                      font-family: ui-monospace, SFMono-Regular, monospace; }
        .entries .type { width: 18px; }
        .empty-row { color: #57606a; font-style: italic; }
        .log {
          background: #0d1117; color: #c9d1d9; padding: 12px;
          border-radius: 6px; font-size: 12px; line-height: 1.5;
          max-height: 320px; overflow-y: auto;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .log :global(.err) { color: #ff7b72; }
        .log :global(.muted) { color: #6e7681; }
      `}</style>
    </main>
  );
}
