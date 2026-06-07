'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type LocalGallery,
  type PhotoIndexProgress,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { useAdapterImage } from '@/components/desktop/useAdapterImage';
import { useElementWidth } from '@/lib/justifiedLayout';
import {
  columnsForWidth,
  computeMasonry,
  DEFAULT_RATIO,
  type MasonryTile,
} from '@/lib/masonryLayout';
import { buildLocalGalleryDb } from '@/lib/localGalleryDb';
import {
  formatTimelineDate,
  listTimelinePhotos,
  type TimelinePhoto,
} from '@/lib/photoTimeline';

const GAP = 6;
const PAGE = 80; // photos revealed per infinite-scroll step
const THUMB_WIDTH = 480;

type BuildStatus = 'loading' | 'ready' | 'error';

function picgFileUrl(galleryId: string, p: string): string {
  return `picg://gallery/${encodeURIComponent(galleryId)}/${p
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

// A Live Photo's motion is a sibling `<name>.mov` (some cameras write .MOV).
// Return both casings as <source> candidates — the browser falls through to
// the second if the first 404s, which matters on case-sensitive filesystems.
function livePhotoSources(galleryId: string, imgPath: string): string[] {
  return ['.mov', '.MOV'].map((ext) =>
    picgFileUrl(galleryId, imgPath.replace(/\.[^./]+$/, ext))
  );
}

export default function TimelinePage() {
  const params = useParams<{ id: string }>();
  const galleryId = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);

  const [status, setStatus] = useState<BuildStatus>('loading');
  const [progress, setProgress] = useState<PhotoIndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<TimelinePhoto[]>([]);

  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [floatingDate, setFloatingDate] = useState<string | null>(null);

  const { ref: gridRef, width } = useElementWidth<HTMLDivElement>();
  const gridElRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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

  // Build (or refresh) the local index, then read the timeline rows out of
  // the freshly-built sqlite.db. The DB is closed once we've extracted rows —
  // we hold the rows, not the handle.
  useEffect(() => {
    if (!bridge || !galleryId) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    (async () => {
      try {
        const db = await buildLocalGalleryDb(bridge, galleryId, (p) => {
          if (!cancelled) setProgress(p);
        });
        let rows;
        try {
          rows = listTimelinePhotos(db);
        } finally {
          db.close(); // always reclaim the wasm-heap Database, even on throw
        }
        if (cancelled) return;
        setPhotos(rows);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, galleryId]);

  // Batch per-image ratio measurements: each <img> onLoad pushes into a ref
  // and a single rAF flush coalesces a burst of loads into one setRatios, so
  // the masonry recomputes a handful of times instead of once per thumbnail
  // (which would relayout — and visibly jump — every tile below it).
  const pendingRatios = useRef<Record<string, number>>({});
  const ratioRaf = useRef(0);
  const flushRatios = useCallback(() => {
    ratioRaf.current = 0;
    const pending = pendingRatios.current;
    pendingRatios.current = {};
    setRatios((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k in pending) {
        if (next[k] !== pending[k]) {
          next[k] = pending[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);
  const recordRatio = useCallback(
    (path: string, ratio: number) => {
      pendingRatios.current[path] = ratio;
      if (!ratioRaf.current) ratioRaf.current = requestAnimationFrame(flushRatios);
    },
    [flushRatios]
  );
  useEffect(
    () => () => {
      if (ratioRaf.current) cancelAnimationFrame(ratioRaf.current);
    },
    []
  );

  const visiblePhotos = useMemo(
    () => photos.slice(0, visibleCount),
    [photos, visibleCount]
  );

  const masonry = useMemo(
    () =>
      computeMasonry(
        visiblePhotos.map((p) => ({ item: p, ratio: ratios[p.path] ?? DEFAULT_RATIO })),
        width,
        { columns: columnsForWidth(width), gap: GAP }
      ),
    [visiblePhotos, ratios, width]
  );

  // Keep the latest tiles available to the (un-resubscribed) scroll handler.
  const tilesRef = useRef<MasonryTile<TimelinePhoto>[]>([]);
  tilesRef.current = masonry.tiles;

  // Floating date = the date of the tile most recently scrolled to/above the
  // viewport top. Masonry columns make tile.y non-monotonic in render order,
  // so we pick the GREATEST y still above the threshold (not the first tile
  // past it). Reads tiles via a ref so the scroll handler never has to
  // re-subscribe as thumbnails stream in.
  const updateFloatingDate = useCallback(() => {
    const el = gridElRef.current;
    const tiles = tilesRef.current;
    if (!el || tiles.length === 0) return;
    const gridTop = el.getBoundingClientRect().top; // viewport-relative
    const threshold = 96; // a touch below the topbar
    let current = tiles[0].item;
    let bestY = -Infinity;
    for (const tile of tiles) {
      if (gridTop + tile.y <= threshold && tile.y >= bestY) {
        bestY = tile.y;
        current = tile.item;
      }
    }
    setFloatingDate(current.date);
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateFloatingDate();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [status, updateFloatingDate]);

  // Refresh the shown date as the layout settles (width measured, ratios
  // filling in) without re-subscribing the scroll listener above.
  useEffect(() => {
    updateFloatingDate();
  }, [masonry, updateFloatingDate]);

  // Infinite scroll: reveal another page when the sentinel nears the viewport.
  useEffect(() => {
    if (status !== 'ready') return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => (c < photos.length ? c + PAGE : c));
        }
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [status, photos.length]);

  // Lightbox keyboard nav over the full (not just visible) list.
  useEffect(() => {
    if (lightboxIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') {
        setLightboxIndex((i) => (i != null && i < photos.length - 1 ? i + 1 : i));
      }
      if (e.key === 'ArrowLeft') {
        setLightboxIndex((i) => (i != null && i > 0 ? i - 1 : i));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, photos.length]);

  if (!bridge) {
    return (
      <div className="page">
        <main className="empty"><h1>Desktop only</h1></main>
        <DesktopTheme />
      </div>
    );
  }
  if (!gallery) {
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
  const datedCount = photos.filter((p) => p.date).length;
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

  return (
    <div className="page">
      <Topbar />

      <main ref={gridRef}>
        <Link href={galleryHref as any} className="picg-back-link">
          ← {gallery.fullName}
        </Link>

        <section className="hero">
          <h1>Timeline</h1>
          <p className="meta">
            {status === 'ready'
              ? `${photos.length} photo${photos.length === 1 ? '' : 's'} · ${datedCount} dated`
              : 'All photos by capture date, newest first.'}
          </p>
        </section>

        {status === 'loading' && (
          <div className="build">
            <div className="build-label">
              {progress?.phase === 'scan'
                ? 'Scanning albums…'
                : `Reading EXIF… ${progress?.processed ?? 0}/${progress?.total ?? 0}`}
            </div>
            <div className="build-bar">
              <div className="build-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="build-hint">
              First build reads every photo&apos;s EXIF; it&apos;s cached after,
              so later visits are instant.
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="picg-banner">
            Could not build the local index: {error}
          </div>
        )}

        {status === 'ready' && photos.length === 0 && (
          <div className="empty-block">
            <p>No photos found in this gallery&apos;s albums.</p>
            <p className="hint">
              The timeline indexes images listed under albums in
              <code> README.yml</code>.
            </p>
          </div>
        )}

        {status === 'ready' && photos.length > 0 && (
          <>
            {floatingDate !== null && (
              <div className="floating-date">{formatTimelineDate(floatingDate)}</div>
            )}
            <div
              className="masonry"
              ref={gridElRef}
              style={{ height: masonry.height }}
            >
              {masonry.tiles.map((tile, i) => (
                <TimelineTile
                  key={tile.item.path}
                  adapter={adapter}
                  galleryId={gallery.id}
                  photo={tile.item}
                  x={tile.x}
                  y={tile.y}
                  width={tile.width}
                  height={tile.height}
                  onRatio={recordRatio}
                  onOpen={() => setLightboxIndex(i)}
                />
              ))}
            </div>
            <div ref={sentinelRef} className="sentinel" aria-hidden="true" />
          </>
        )}
      </main>

      {lightboxIndex != null && photos[lightboxIndex] && (
        <Lightbox
          adapter={adapter}
          galleryId={gallery.id}
          photo={photos[lightboxIndex]}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 96px; max-width: 1600px; margin: 0 auto; }

        .hero { margin-bottom: 24px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 48px; font-weight: 400; letter-spacing: -0.01em;
          margin: 0 0 8px; color: var(--text); line-height: 1.1;
        }
        .meta {
          margin: 0; font-family: var(--mono); font-size: 12px;
          letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted);
        }

        .build { padding: 48px 0; max-width: 480px; }
        .build-label {
          font-family: var(--mono); font-size: 12px; letter-spacing: 0.05em;
          text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px;
        }
        .build-bar {
          height: 4px; border-radius: 2px; background: var(--bg-card);
          overflow: hidden;
        }
        .build-fill {
          height: 100%; background: var(--accent);
          transition: width 0.2s ease; border-radius: 2px;
        }
        .build-hint {
          margin-top: 12px; font-size: 12px; color: var(--text-faint);
          line-height: 1.5;
        }
        .build-hint code {
          font-family: var(--mono); background: var(--bg-card);
          padding: 1px 5px; border-radius: 4px; color: var(--text);
        }

        .empty-block {
          padding: 56px 24px; text-align: center; color: var(--text-muted);
          border: 1px dashed var(--border-strong); border-radius: 14px;
        }
        .empty-block p { margin: 0; }
        .empty-block p + p { margin-top: 8px; }
        .empty-block .hint {
          font-family: var(--mono); font-size: 11px; letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .empty-block code {
          font-family: var(--mono); background: var(--bg-card);
          padding: 1px 6px; border-radius: 4px; color: var(--text);
        }

        .floating-date {
          position: sticky; top: 12px; z-index: 5; width: fit-content;
          margin: 0 auto 12px; padding: 6px 16px; border-radius: 999px;
          background: rgba(20, 18, 14, 0.82);
          backdrop-filter: blur(8px);
          border: 1px solid var(--border-strong);
          font-family: var(--mono); font-size: 12px; letter-spacing: 0.04em;
          color: var(--text); pointer-events: none;
        }

        .masonry { position: relative; width: 100%; }
        .sentinel { height: 1px; }
      `}</style>
    </div>
  );
}

function TimelineTile({
  adapter,
  galleryId,
  photo,
  x,
  y,
  width,
  height,
  onRatio,
  onOpen,
}: {
  adapter: StorageAdapter | null;
  galleryId: string;
  photo: TimelinePhoto;
  x: number;
  y: number;
  width: number;
  height: number;
  onRatio: (path: string, ratio: number) => void;
  onOpen: () => void;
}) {
  const { src } = useAdapterImage(adapter, photo.path, {
    picgGalleryId: galleryId,
    thumbWidth: THUMB_WIDTH,
  });
  // Hover-play the Live Photo motion (Apple-Photos style). The <video> uses
  // the still as its poster, so if the .mov can't decode the tile just keeps
  // showing the still — never worse than no hover.
  const [hover, setHover] = useState(false);
  const live = photo.livephoto;
  return (
    <button
      className="tl-tile"
      style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
      onClick={onOpen}
      title={photo.name}
      aria-label={photo.name}
      onMouseEnter={live ? () => setHover(true) : undefined}
      onMouseLeave={live ? () => setHover(false) : undefined}
    >
      {src ? (
        <img
          src={src}
          alt={photo.name}
          loading="lazy"
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w && h) onRatio(photo.path, w / h);
          }}
        />
      ) : (
        <div className="tl-ph" />
      )}
      {live && hover && src && (
        <video
          className="tl-video"
          poster={src}
          autoPlay
          loop
          muted
          playsInline
          preload="none"
        >
          {livePhotoSources(galleryId, photo.path).map((u) => (
            <source key={u} src={u} type="video/quicktime" />
          ))}
        </video>
      )}
      {live && <span className="tl-live">LIVE</span>}
      <style jsx>{`
        .tl-tile {
          position: absolute; top: 0; left: 0; padding: 0; margin: 0;
          border: none; border-radius: 4px; overflow: hidden; cursor: pointer;
          background: var(--bg-card);
          will-change: transform;
        }
        .tl-tile img {
          width: 100%; height: 100%; object-fit: cover; display: block;
          opacity: 0; transition: opacity 0.3s ease;
          animation: tl-in 0.01s forwards;
        }
        .tl-tile img[src] { opacity: 1; }
        .tl-video {
          position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; display: block;
        }
        .tl-ph { width: 100%; height: 100%; background: var(--bg-card); }
        .tl-live {
          position: absolute; top: 6px; right: 6px;
          font-family: var(--mono); font-size: 9px; letter-spacing: 0.08em;
          padding: 2px 6px; border-radius: 999px;
          background: rgba(0, 0, 0, 0.55); color: #fff;
          pointer-events: none;
        }
        @keyframes tl-in { to { opacity: 1; } }
      `}</style>
    </button>
  );
}

function Lightbox({
  adapter,
  galleryId,
  photo,
  onClose,
}: {
  adapter: StorageAdapter | null;
  galleryId: string;
  photo: TimelinePhoto;
  onClose: () => void;
}) {
  const { src } = useAdapterImage(adapter, photo.path, { picgGalleryId: galleryId });
  // Live Photos autoplay the motion (still as poster). If the .mov can't be
  // decoded the <video> fires onError and we drop back to the still <img>.
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = photo.livephoto && !videoFailed;
  const exifBits = [
    photo.model,
    photo.focalLength ? `${photo.focalLength}mm` : null,
    photo.fNumber ? `f/${photo.fNumber}` : null,
    photo.exposureTime ? `${photo.exposureTime}s` : null,
    photo.iso ? `ISO ${photo.iso}` : null,
  ].filter(Boolean);

  return (
    <div className="picg-lightbox" onClick={onClose}>
      <button className="picg-lightbox-close" onClick={onClose} aria-label="Close">✕</button>
      {showVideo ? (
        <video
          className="picg-lightbox-video"
          poster={src ?? undefined}
          autoPlay
          loop
          muted
          playsInline
          onClick={(e) => e.stopPropagation()}
          onError={() => setVideoFailed(true)}
        >
          {livePhotoSources(galleryId, photo.path).map((u) => (
            <source key={u} src={u} type="video/quicktime" />
          ))}
        </video>
      ) : (
        src && <img src={src} alt={photo.name} onClick={(e) => e.stopPropagation()} />
      )}
      <div className="picg-lightbox-meta">
        {/* Filename can be long; truncate it with an ellipsis (full name on
            hover) so it never wraps the meta pill onto a second line. The EXIF
            fields after it are bounded, so they stay readable. */}
        <span className="lb-name" title={photo.name}>{photo.name}</span>
        {photo.livephoto && <span className="lb-tag"> · LIVE</span>}
        {photo.dateTime && <span className="lb-tag"> · {photo.dateTime}</span>}
        {exifBits.length > 0 && <span className="lb-tag"> · {exifBits.join(' · ')}</span>}
      </div>
      <style jsx>{`
        .picg-lightbox-video {
          max-width: 92vw;
          max-height: 86vh;
          object-fit: contain;
          border-radius: 4px;
        }
        .lb-name {
          max-width: 240px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 1;
          min-width: 2.5em;
        }
        .lb-tag {
          white-space: nowrap;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
