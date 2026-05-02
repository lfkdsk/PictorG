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

  const [bridge, setBridge] = useState<PicgBridge | null>(null);
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [readmeMissing, setReadmeMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

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
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDrop(targetUrl: string) {
    if (!albums || !draggingUrl || draggingUrl === targetUrl) return;
    const fromIdx = albums.findIndex((a) => a.url === draggingUrl);
    let toIdx = albums.findIndex((a) => a.url === targetUrl);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...albums];
    const [moved] = next.splice(fromIdx, 1);
    if (fromIdx < toIdx) toIdx -= 1;
    next.splice(toIdx, 0, moved);
    setAlbums(next);
    setDraggingUrl(null);
    void persistOrder(next);
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
            <Link
              href={`/desktop/galleries/${encodeURIComponent(gallery.id)}/new-album` as any}
              className="btn primary"
            >
              + New album
            </Link>
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
                  onDrop={() => handleDrop(album.url)}
                />
              </li>
            ))}
          </ul>
        )}

        {albums && albums.length === 0 && !readmeMissing && (
          <div className="empty-block">
            <p>This gallery has no albums yet.</p>
          </div>
        )}
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1200px; margin: 0 auto; }

        .hero { margin-bottom: 32px; }
        .hero-row {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 24px;
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
  onDrop,
}: {
  galleryId: string;
  adapter: StorageAdapter | null;
  album: Album;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  // README.yml's `cover` is the path from repo root (matches the web flow's
  // `${thumbnail_url}/${album.cover}`), not a filename relative to album.url.
  const coverPath = album.cover || null;
  const { src, error } = useAdapterImage(adapter, coverPath);
  const albumHref = `/desktop/galleries/${encodeURIComponent(galleryId)}/${encodeURIComponent(album.url)}`;

  // Plain div + onClick instead of <Link> so the HTML5 drag handlers don't
  // fight the browser's default link drag behaviour. router.push gives us
  // the same SPA navigation a Link would.
  return (
    <div
      className={`picg-album-card ${isDragging ? 'is-dragging' : ''} ${hovered ? 'is-drop-target' : ''}`}
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
      onDragEnd={() => {
        setHovered(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={() => setHovered(true)}
      onDragLeave={() => setHovered(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHovered(false);
        onDrop();
      }}
    >
      <div className="picg-album-cover">
        {src && <img src={src} alt="" loading="lazy" draggable={false} />}
        {!src && !error && <div className="picg-album-cover-placeholder" />}
        {error && <div className="picg-album-cover-error">{error}</div>}
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
    </div>
  );
}
