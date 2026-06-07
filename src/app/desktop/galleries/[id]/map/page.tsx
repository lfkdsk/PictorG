'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { Map as LeafletMap } from 'leaflet';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type LocalGallery,
  type PhotoIndexProgress,
  type PicgBridge,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { buildLocalGalleryDb } from '@/lib/localGalleryDb';
import { listGeotaggedPhotos, type GeoPhoto } from '@/lib/photoTimeline';

type Status = 'loading' | 'ready' | 'error';

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<
        string,
        string
      >)[c]
  );
}

function thumbUrl(galleryId: string, path: string): string {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  return `picg://gallery/${encodeURIComponent(galleryId)}/${enc}?thumb=240`;
}

export default function MapPage() {
  const params = useParams<{ id: string }>();
  const galleryId = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [gallery, setGallery] = useState<LocalGallery | null>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [progress, setProgress] = useState<PhotoIndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<GeoPhoto[]>([]);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    setBridge(getPicgBridge());
  }, []);

  useEffect(() => {
    if (!bridge || !galleryId) return;
    bridge.gallery.resolve(galleryId).then(setGallery);
  }, [bridge, galleryId]);

  // Build/open the local index, pull the geotagged photos, close the DB.
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
        let rows: GeoPhoto[];
        try {
          rows = listGeotaggedPhotos(db);
        } finally {
          db.close();
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

  // Create the Leaflet map once photos are in. Leaflet touches `window` at
  // import time, so it's dynamically imported here (client-only) rather than
  // at module top, which would crash the renderer's SSR pass.
  useEffect(() => {
    if (status !== 'ready' || photos.length === 0 || !galleryId) return;
    const el = mapElRef.current;
    if (!el) return;

    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapElRef.current) return;

      const map = L.map(mapElRef.current, { worldCopyJump: true });
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const icon = L.divIcon({
        className: 'picg-map-dot',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const latlngs: [number, number][] = [];
      for (const p of photos) {
        const marker = L.marker([p.lat, p.lon], { icon }).addTo(map);
        const cap = `${escapeHtml(p.name)}${p.date ? ` · ${escapeHtml(p.date)}` : ''}`;
        marker.bindPopup(
          `<div class="picg-pop"><img src="${thumbUrl(galleryId, p.path)}" alt="" loading="lazy"/><div class="picg-pop-cap">${cap}</div></div>`,
          { minWidth: 200, maxWidth: 240 }
        );
        latlngs.push([p.lat, p.lon]);
      }
      map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 14 });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [status, photos, galleryId]);

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
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href={galleryHref as any} className="picg-back-link">
          ← {gallery.fullName}
        </Link>

        <section className="hero">
          <h1>Map</h1>
          <p className="meta">
            {status === 'ready'
              ? `${photos.length} geotagged photo${photos.length === 1 ? '' : 's'}`
              : 'Photos with GPS coordinates, plotted by location.'}
          </p>
        </section>

        {status === 'loading' && (
          <div className="build">
            <div className="build-label">
              {progress?.phase === 'scan'
                ? 'Scanning albums…'
                : `Reading EXIF… ${progress?.processed ?? 0}/${progress?.total ?? 0}`}
            </div>
            <div className="build-bar"><div className="build-fill" style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        {status === 'error' && (
          <div className="picg-banner">Could not build the local index: {error}</div>
        )}

        {status === 'ready' && photos.length === 0 && (
          <div className="empty-block">
            <p>No geotagged photos in this gallery.</p>
            <p className="hint">Only photos whose EXIF carries GPS coordinates appear here.</p>
          </div>
        )}

        {status === 'ready' && photos.length > 0 && (
          <div className="map-canvas" ref={mapElRef} />
        )}
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 48px; max-width: 1400px; margin: 0 auto; }
        .hero { margin-bottom: 20px; }
        .hero h1 {
          font-family: var(--serif); font-size: 48px; font-weight: 400;
          letter-spacing: -0.01em; margin: 0 0 8px; color: var(--text); line-height: 1.1;
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
        .build-bar { height: 4px; border-radius: 2px; background: var(--bg-card); overflow: hidden; }
        .build-fill { height: 100%; background: var(--accent); transition: width 0.2s ease; border-radius: 2px; }
        .empty-block {
          padding: 56px 24px; text-align: center; color: var(--text-muted);
          border: 1px dashed var(--border-strong); border-radius: 14px;
        }
        .empty-block p { margin: 0; }
        .empty-block p + p { margin-top: 8px; }
        .empty-block .hint {
          font-family: var(--mono); font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
        }
        .map-canvas {
          height: calc(100vh - 230px); min-height: 380px;
          border-radius: 12px; overflow: hidden;
          border: 1px solid var(--border);
          background: var(--bg-card);
        }
      `}</style>

      {/* Leaflet injects its own DOM outside React, so its bits need global CSS. */}
      <style jsx global>{`
        .picg-map-dot {
          background: var(--accent, #e8a04a);
          border: 2px solid #fff;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
        }
        .leaflet-popup-content { margin: 8px; }
        .picg-pop img {
          width: 100%; height: auto; display: block; border-radius: 6px;
          background: #1a1a1c;
        }
        .picg-pop-cap {
          margin-top: 6px; font-size: 12px; color: #222;
          font-family: var(--mono, monospace); word-break: break-all;
        }
      `}</style>
    </div>
  );
}
