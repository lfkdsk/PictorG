'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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

  const sortedAlbums = useMemo(() => {
    if (!albums) return null;
    return [...albums].sort((a, b) => {
      // Newest date first; albums with no parsable date drop to the end.
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      const va = Number.isNaN(ta) ? -Infinity : ta;
      const vb = Number.isNaN(tb) ? -Infinity : tb;
      return vb - va;
    });
  }, [albums]);

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
          <h1>{gallery.fullName}</h1>
          <p className="meta">
            {defaultBranch && <><span>{defaultBranch}</span><span className="dot">•</span></>}
            <span>{formatBytes(gallery.sizeBytes)}</span>
            <span className="dot">•</span>
            <span>
              {sortedAlbums == null
                ? 'loading albums…'
                : `${sortedAlbums.length} album${sortedAlbums.length === 1 ? '' : 's'}`}
            </span>
          </p>
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

        {sortedAlbums && sortedAlbums.length > 0 && (
          <ul className="album-grid">
            {sortedAlbums.map((album) => (
              <li key={album.url} className="album-cell">
                <AlbumCard
                  galleryId={gallery.id}
                  adapter={adapter}
                  album={album}
                />
              </li>
            ))}
          </ul>
        )}

        {sortedAlbums && sortedAlbums.length === 0 && !readmeMissing && (
          <div className="empty-block">
            <p>This gallery has no albums yet.</p>
          </div>
        )}
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1200px; margin: 0 auto; }

        .hero { margin-bottom: 32px; }
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
}: {
  galleryId: string;
  adapter: StorageAdapter | null;
  album: Album;
}) {
  // README.yml's `cover` is the path from repo root (matches the web flow's
  // `${thumbnail_url}/${album.cover}`), not a filename relative to album.url.
  const coverPath = album.cover || null;
  const { src, error } = useAdapterImage(adapter, coverPath);
  const albumHref = `/desktop/galleries/${encodeURIComponent(galleryId)}/${encodeURIComponent(album.url)}`;

  return (
    <Link href={albumHref as any} className="picg-album-card">
      <div className="picg-album-cover">
        {src && <img src={src} alt="" loading="lazy" />}
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
    </Link>
  );
}
