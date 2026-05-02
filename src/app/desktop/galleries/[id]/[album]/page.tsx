'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import yaml from 'js-yaml';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type DirectoryEntry,
  type LocalGallery,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { useAdapterImage } from '@/components/desktop/useAdapterImage';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'];

type AlbumMeta = {
  name: string;
  url: string;
  date?: string;
  style?: string;
  cover?: string;
};

function isImage(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function findAlbum(yamlText: string, url: string): AlbumMeta | null {
  const data = yaml.load(yamlText, {
    schema: yaml.CORE_SCHEMA,
    json: true,
  }) as Record<string, Omit<AlbumMeta, 'name'>> | null;
  if (!data) return null;
  for (const [name, fields] of Object.entries(data)) {
    if (fields?.url === url) {
      return {
        name: name.trim(),
        ...fields,
        date: typeof fields.date === 'string' ? fields.date : String(fields.date ?? ''),
      };
    }
  }
  return null;
}

export default function AlbumPage() {
  const params = useParams<{ id: string; album: string }>();
  const galleryId = params?.id;
  const albumUrl = useMemo(() => {
    try {
      return params?.album ? decodeURIComponent(params.album) : null;
    } catch {
      return params?.album ?? null;
    }
  }, [params?.album]);

  const [bridge, setBridge] = useState<PicgBridge | null>(null);
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [albumMeta, setAlbumMeta] = useState<AlbumMeta | null>(null);
  const [images, setImages] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);

  useEffect(() => {
    setBridge(getPicgBridge());
  }, []);

  useEffect(() => {
    if (!bridge || !galleryId) return;
    bridge.gallery.resolve(galleryId).then((g) => {
      setGallery(g);
      if (g) {
        setAdapter(
          new PreloadBridgeAdapter({ repoPath: g.localPath, bridge: bridge.storage })
        );
      }
    });
  }, [bridge, galleryId]);

  useEffect(() => {
    if (!adapter || !albumUrl) return;
    let cancelled = false;
    (async () => {
      try {
        // README.yml may be missing on a freshly-cloned non-PicG repo;
        // fall through to listing the directory anyway.
        try {
          const readme = await adapter.readFile('README.yml');
          if (!cancelled) setAlbumMeta(findAlbum(readme.text(), albumUrl));
        } catch {
          /* ignore */
        }

        const entries = await adapter.listDirectory(albumUrl);
        if (cancelled) return;
        setImages(entries.filter((e) => e.type === 'file' && isImage(e.name)));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, albumUrl]);

  // Close lightbox on Escape, navigate with arrow keys.
  useEffect(() => {
    if (!lightboxPath || !images) return;
    const idx = images.findIndex((img) => `${albumUrl}/${img.name}` === lightboxPath);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxPath(null);
      if (e.key === 'ArrowRight' && idx >= 0 && idx < images.length - 1) {
        setLightboxPath(`${albumUrl}/${images[idx + 1].name}`);
      }
      if (e.key === 'ArrowLeft' && idx > 0) {
        setLightboxPath(`${albumUrl}/${images[idx - 1].name}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxPath, images, albumUrl]);

  if (!bridge) {
    return (
      <div className="page">
        <main className="empty"><h1>Desktop only</h1></main>
        <DesktopTheme />
      </div>
    );
  }
  if (!gallery || !albumUrl) {
    return (
      <div className="page">
        <Topbar />
        <main className="loading"><p>Loading…</p></main>
        <DesktopTheme />
        <style jsx>{`
          .loading { padding: 96px; text-align: center; color: var(--text-muted);
                     font-family: var(--mono); font-size: 13px;
                     letter-spacing: 0.05em; text-transform: uppercase; }
        `}</style>
      </div>
    );
  }

  const galleryHref = `/desktop/galleries/${encodeURIComponent(gallery.id)}`;

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href={galleryHref as any} className="picg-back-link">
          ← {gallery.fullName}
        </Link>

        <section className="hero">
          <h1>{albumMeta?.name ?? albumUrl}</h1>
          <p className="meta">
            {albumMeta?.date && <><span>{formatDate(albumMeta.date)}</span><span className="dot">•</span></>}
            <span>
              {images == null
                ? 'loading…'
                : `${images.length} image${images.length === 1 ? '' : 's'}`}
            </span>
            {albumMeta?.style && (
              <>
                <span className="dot">•</span>
                <span>{albumMeta.style}</span>
              </>
            )}
          </p>
          <p className="path"><code>{albumUrl}/</code></p>
        </section>

        {loadError && (
          <div className="banner">{loadError}</div>
        )}

        {images && images.length === 0 && (
          <div className="empty-block">
            <p>No images in this album.</p>
          </div>
        )}

        {images && images.length > 0 && (
          <ul className="picg-thumbs">
            {images.map((img) => (
              <Thumb
                key={img.path}
                adapter={adapter}
                albumUrl={albumUrl}
                name={img.name}
                onOpen={() => setLightboxPath(`${albumUrl}/${img.name}`)}
              />
            ))}
          </ul>
        )}
      </main>

      {lightboxPath && (
        <Lightbox
          adapter={adapter}
          path={lightboxPath}
          onClose={() => setLightboxPath(null)}
        />
      )}

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1200px; margin: 0 auto; }

        .hero { margin-bottom: 24px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 40px;
          font-weight: 400;
          letter-spacing: -0.01em;
          margin: 0 0 8px;
          color: var(--text);
          line-height: 1.15;
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
      `}</style>
    </div>
  );
}

function Thumb({
  adapter,
  albumUrl,
  name,
  onOpen,
}: {
  adapter: StorageAdapter | null;
  albumUrl: string;
  name: string;
  onOpen: () => void;
}) {
  const { src } = useAdapterImage(adapter, `${albumUrl}/${name}`);
  return (
    <li>
      <button className="picg-thumb" onClick={onOpen} aria-label={name}>
        {src ? <img src={src} alt={name} loading="lazy" /> : <div className="picg-thumb-placeholder" />}
      </button>
    </li>
  );
}

function Lightbox({
  adapter,
  path,
  onClose,
}: {
  adapter: StorageAdapter | null;
  path: string;
  onClose: () => void;
}) {
  const { src } = useAdapterImage(adapter, path);
  const filename = path.split('/').pop() ?? path;

  return (
    <div className="picg-lightbox" onClick={onClose}>
      <button className="picg-lightbox-close" onClick={onClose} aria-label="Close">✕</button>
      {src && <img src={src} alt={filename} onClick={(e) => e.stopPropagation()} />}
      <div className="picg-lightbox-meta">
        <span>{filename}</span>
      </div>
    </div>
  );
}
