'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import yaml from 'js-yaml';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type LocalGallery,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { useAdapterImage } from '@/components/desktop/useAdapterImage';
import { EditGalleryModal } from '@/components/desktop/EditGalleryModal';
import { fireUndoToast, UndoToastHost } from '@/components/desktop/UndoToast';

type Album = {
  name: string;        // YAML key — display name (often Chinese)
  url: string;         // directory name inside the repo
  date: string;
  style?: string;
  cover: string;       // filename inside the album directory
  location?: [number, number];
};

function formatBytes(n?: number): string {
  if (!n || n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(value: string | Date | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function parseAlbums(yamlText: string): Album[] {
  const data = yaml.load(yamlText, {
    schema: yaml.CORE_SCHEMA,
    json: true,
  }) as Record<string, Omit<Album, 'name'>> | null;
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([name, fields]) => ({
    name: name.trim(),
    ...fields,
    date: typeof fields.date === 'string' ? fields.date : String(fields.date ?? ''),
  }));
}

export default function GalleryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [readmeMissing, setReadmeMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [editGalleryOpen, setEditGalleryOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [ahead, setAhead] = useState(0);
  const [opError, setOpError] = useState<string | null>(null);

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

  // Pull the unpushed-commit count once the gallery is resolved. Cheap
  // (local git status, no fetch); refreshed after push.
  useEffect(() => {
    if (!bridge || !gallery) return;
    let cancelled = false;
    bridge.gallery
      .status(gallery.id)
      .then((s) => {
        if (!cancelled) setAhead(s.ahead);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bridge, gallery]);

  useEffect(() => {
    if (!adapter) return;
    let cancelled = false;
    (async () => {
      try {
        const branch = await adapter.getDefaultBranch();
        if (cancelled) return;
        setDefaultBranch(branch);

        const meta = await adapter.readFileMetadata('README.yml');
        if (!meta) {
          if (!cancelled) {
            setReadmeMissing(true);
            setAlbums([]);
          }
          return;
        }
        const file = await adapter.readFile('README.yml');
        if (cancelled) return;
        setAlbums(parseAlbums(file.text()));
        setReadmeMissing(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // Album order = README.yml key order. Drag/drop on the grid mutates this
  // and writes the rearranged YAML back so refreshes are stable.
  async function persistOrder(next: Album[]) {
    if (!adapter) return;
    setReorderError(null);
    try {
      const file = await adapter.readFile('README.yml');
      const data =
        (yaml.load(file.text(), { schema: yaml.CORE_SCHEMA, json: true }) ??
          {}) as Record<string, any>;

      // Rebuild with the new ordering. Any extra keys we don't know about
      // (shouldn't normally exist, but stay safe) are appended at the end.
      const reordered: Record<string, any> = {};
      for (const album of next) {
        if (data[album.name]) reordered[album.name] = data[album.name];
      }
      for (const k of Object.keys(data)) {
        if (!(k in reordered)) reordered[k] = data[k];
      }

      const yamlText = yaml.dump(reordered, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });

      await adapter.writeFile('README.yml', yamlText, 'Reorder albums');
      if (gallery) fireUndoToast({ galleryId: gallery.id, message: 'Reordered albums' });
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : String(err));
    }
  }

  // Live reorder on dragover so the grid follows the cursor instead of
  // jumping only at drop. The "move dragging item into target's slot" pass
  // is idempotent — re-firing on the same target after a swap is a no-op
  // because findIndex picks up the post-swap positions, so this is stable
  // even though dragover fires every mouse move.
  function handleDragOver(targetUrl: string) {
    if (!albums || !draggingUrl || draggingUrl === targetUrl) return;
    const fromIdx = albums.findIndex((a) => a.url === draggingUrl);
    const toIdx = albums.findIndex((a) => a.url === targetUrl);
    if (fromIdx < 0 || toIdx < 0) return;
    const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
    if (insertIdx === fromIdx) return;
    const next = [...albums];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(insertIdx, 0, moved);
    setAlbums(next);
  }

  function handleDrop() {
    if (!albums) return;
    setDraggingUrl(null);
    void persistOrder(albums);
  }

  // Hovering the trailing slot (rendered after the last card while
  // dragging) snaps the dragged item to the end of the list. Same
  // idempotent splice/insert pattern as handleDragOver.
  function handleDragOverEnd() {
    if (!albums || !draggingUrl) return;
    const fromIdx = albums.findIndex((a) => a.url === draggingUrl);
    if (fromIdx < 0 || fromIdx === albums.length - 1) return;
    const next = [...albums];
    const [moved] = next.splice(fromIdx, 1);
    next.push(moved);
    setAlbums(next);
  }

  async function handlePull() {
    if (!bridge || !gallery || pulling) return;
    setPulling(true);
    setOpError(null);
    try {
      await bridge.gallery.sync(gallery.id);
      // git pull may have changed README.yml / images / sizeBytes / etc.
      // Hard nav reloads the page against fresh state.
      const href = `/desktop/galleries/${encodeURIComponent(gallery.id)}?t=${Date.now()}`;
      if (typeof window !== 'undefined') {
        window.location.assign(href);
      }
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
      setPulling(false);
    }
  }

  async function handlePush() {
    if (!bridge || !gallery || pushing) return;
    setPushing(true);
    setOpError(null);
    try {
      await bridge.gallery.push(gallery.id);
      // Push doesn't change local content; just refresh the unpushed
      // counter so the badge updates without a full page reload.
      const s = await bridge.gallery.status(gallery.id);
      setAhead(s.ahead);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
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

  const topbarActions = (
    <>
      <button
        type="button"
        className="picg-icon-btn"
        aria-label="Pull from remote"
        title="Pull from remote (git pull)"
        onClick={handlePull}
        disabled={pulling || pushing}
      >
        <span className={pulling ? 'picg-spin' : ''}>↓</span>
      </button>
      <button
        type="button"
        className="picg-icon-btn"
        aria-label={ahead > 0 ? `Push ${ahead} commit${ahead === 1 ? '' : 's'} to remote` : 'Push to remote'}
        title={ahead > 0 ? `Push ${ahead} commit${ahead === 1 ? '' : 's'} (git push)` : 'Push to remote (git push)'}
        onClick={handlePush}
        disabled={pulling || pushing}
      >
        <span className={pushing ? 'picg-spin' : ''}>↑</span>
        {ahead > 0 && <span className="picg-badge-count">{ahead}</span>}
      </button>
    </>
  );

  return (
    <div className="page">
      <Topbar actions={topbarActions} />

      <main>
        <Link href="/desktop/galleries" className="picg-back-link">
          ← All galleries
        </Link>

        <section className="hero">
          <div className="hero-row">
            <div>
              <h1>{gallery.fullName}</h1>
              <p className="meta">
                {defaultBranch && <><span>{defaultBranch}</span><span className="dot">•</span></>}
                <span>{formatBytes(gallery.sizeBytes)}</span>
                <span className="dot">•</span>
                <span>
                  {albums == null
                    ? 'loading albums…'
                    : `${albums.length} album${albums.length === 1 ? '' : 's'}`}
                </span>
              </p>
            </div>
            <div className="hero-actions">
              <Link
                href={`/desktop/galleries/${encodeURIComponent(gallery.id)}/new-album` as any}
                className="btn primary"
              >
                + New album
              </Link>
              <div className="picg-menu-anchor">
                <button
                  type="button"
                  className="picg-icon-btn"
                  aria-label="Gallery actions"
                  aria-haspopup="menu"
                  aria-expanded={moreMenuOpen}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                >
                  ⋯
                </button>
                {moreMenuOpen && (
                  <>
                    <div
                      className="picg-menu-overlay"
                      onClick={() => setMoreMenuOpen(false)}
                    />
                    <div className="picg-menu" role="menu">
                      <button
                        type="button"
                        className="picg-menu-item"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          setEditGalleryOpen(true);
                        }}
                        role="menuitem"
                      >
                        Edit gallery
                      </button>
                      <Link
                        href={`/desktop/galleries/${encodeURIComponent(gallery.id)}/annual-summary` as any}
                        className="picg-menu-item"
                        onClick={() => setMoreMenuOpen(false)}
                        role="menuitem"
                      >
                        Annual summary
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {loadError && (
          <div className="banner">
            <span>{loadError}</span>
          </div>
        )}

        {readmeMissing && (
          <div className="empty-block">
            <p>No <code>README.yml</code> in this repo.</p>
            <p className="hint">Either this isn&apos;t a PicG gallery or it hasn&apos;t been initialized yet.</p>
          </div>
        )}

        {reorderError && (
          <div className="banner">
            <span>Reorder failed: {reorderError}</span>
          </div>
        )}

        {opError && (
          <div className="banner">
            <span>{opError}</span>
          </div>
        )}

        {albums && albums.length > 0 && (
          <ul className="album-grid">
            {albums.map((album) => (
              <li key={album.url} className="album-cell">
                <AlbumCard
                  galleryId={gallery.id}
                  adapter={adapter}
                  album={album}
                  isDragging={draggingUrl === album.url}
                  onDragStart={() => setDraggingUrl(album.url)}
                  onDragEnd={() => setDraggingUrl(null)}
                  onDragOver={() => handleDragOver(album.url)}
                  onDrop={() => handleDrop()}
                />
              </li>
            ))}
            {/* Trailing drop slot only renders during a drag, so the grid
                doesn't have a phantom cell at rest. handleDragOverEnd
                splices the dragged item to the end of the list. */}
            {draggingUrl && (
              <li
                className="album-cell"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  handleDragOverEnd();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop();
                }}
              >
                <div className="album-end-drop" aria-hidden="true">
                  Drop here to move to end
                </div>
              </li>
            )}
          </ul>
        )}

        {albums && albums.length === 0 && !readmeMissing && (
          <div className="empty-block">
            <p>This gallery has no albums yet.</p>
          </div>
        )}
      </main>

      <EditGalleryModal
        adapter={adapter}
        open={editGalleryOpen}
        onClose={() => setEditGalleryOpen(false)}
      />

      <UndoToastHost />
      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1200px; margin: 0 auto; }

        .hero { margin-bottom: 32px; }
        .hero-row {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 24px;
        }
        .hero-actions {
          display: flex; gap: 8px; align-items: center; flex-shrink: 0;
        }
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

        .banner {
          background: rgba(216, 90, 70, 0.12);
          border: 1px solid rgba(216, 90, 70, 0.32);
          color: #f0bfb6;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 13px;
        }

        .empty-block {
          padding: 56px 24px;
          text-align: center;
          color: var(--text-muted);
          border: 1px dashed var(--border-strong);
          border-radius: 14px;
        }
        .empty-block p { margin: 0; }
        .empty-block p + p { margin-top: 8px; }
        .empty-block .hint { font-family: var(--mono); font-size: 11px;
          letter-spacing: 0.05em; text-transform: uppercase; }
        .empty-block code {
          font-family: var(--mono);
          background: var(--bg-card);
          color: var(--text);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .album-grid {
          list-style: none; margin: 0; padding: 0;
          display: grid; gap: 18px;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        }
        .album-cell { display: contents; }
        .album-end-drop {
          aspect-ratio: 1 / 1;
          border: 1px dashed var(--border-strong);
          border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
          text-align: center;
          color: var(--text-faint);
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
        }
        .album-end-drop:hover {
          border-color: var(--accent);
          color: var(--accent);
          background: rgba(255, 255, 255, 0.02);
        }
      `}</style>
    </div>
  );
}

function AlbumCard({
  galleryId,
  adapter,
  album,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  galleryId: string;
  adapter: StorageAdapter | null;
  album: Album;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const router = useRouter();
  // README.yml's `cover` is the path from repo root (matches the web flow's
  // `${thumbnail_url}/${album.cover}`), not a filename relative to album.url.
  const coverPath = album.cover || null;
  // Cards are 260 px wide; ask for 2× to look crisp on retina, capped at
  // 640. Main process resizes + caches the first time each cover is hit.
  const { src, error } = useAdapterImage(adapter, coverPath, {
    picgGalleryId: galleryId,
    thumbWidth: 640,
  });
  const albumHref = `/desktop/galleries/${encodeURIComponent(galleryId)}/${encodeURIComponent(album.url)}`;

  // Plain div + onClick instead of <Link> so the HTML5 drag handlers don't
  // fight the browser's default link drag behaviour. router.push gives us
  // the same SPA navigation a Link would.
  return (
    <div
      className={`picg-album-card ${isDragging ? 'is-dragging' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => router.push(albumHref as any)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(albumHref as any);
        }
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', album.url);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="picg-album-cover">
        {src && !error && <img src={src} alt="" loading="lazy" draggable={false} />}
        {!src && !error && <div className="picg-album-cover-placeholder" />}
        {error && (
          <div
            className="picg-album-cover-error"
            title={error}
          >
            <strong>cover failed</strong>
            <span>{error.length > 80 ? error.slice(0, 80) + '…' : error}</span>
          </div>
        )}
      </div>
      <div className="picg-album-name">{album.name}</div>
      <div className="picg-album-meta">
        {formatDate(album.date)}
        {album.style && (
          <>
            <span className="picg-album-meta-dot">•</span>
            <span>{album.style}</span>
          </>
        )}
      </div>
      {album.location && (
        <div className="picg-album-meta">
          {album.location[0].toFixed(4)}, {album.location[1].toFixed(4)}
        </div>
      )}
    </div>
  );
}
