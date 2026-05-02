'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type LocalGallery,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import {
  listSavedSummaryYears,
  openDeployedGalleryDb,
} from '@/components/desktop/galleryDb';
import { listYearsWithPhotos } from '@/lib/annualSummary';

type YearEntry = {
  year: string;
  saved: boolean;
};

export default function AnnualSummaryYearsPage() {
  const params = useParams<{ id: string }>();
  const galleryId = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(null);
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [entries, setEntries] = useState<YearEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    if (!adapter) return;
    let cancelled = false;
    (async () => {
      try {
        const [db, savedYears] = await Promise.all([
          openDeployedGalleryDb(adapter),
          listSavedSummaryYears(adapter),
        ]);
        if (cancelled) return;
        const photoYears = listYearsWithPhotos(db);
        const savedSet = new Set(savedYears);
        const all = Array.from(new Set([...photoYears, ...savedYears])).sort(
          (a, b) => Number(b) - Number(a)
        );
        setEntries(all.map((year) => ({ year, saved: savedSet.has(year) })));
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

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href={galleryHref as any} className="picg-back-link">
          ← {gallery.fullName}
        </Link>

        <section className="hero">
          <h1>Annual summary</h1>
          <p className="meta">
            Pick one photo per month for a year. Saved to{' '}
            <code>.analysis/annual-summary/&lt;year&gt;.json</code>.
          </p>
        </section>

        {loadError && (
          <div className="picg-banner">
            {/CONFIG\.yml|url 字段/.test(loadError) ? (
              <>
                <code>CONFIG.yml</code> doesn&apos;t have a <code>url</code> field
                — annual summary reads <code>sqlite.db</code> from the deployed
                site, so the gallery has to be deployed at least once first.
              </>
            ) : /sqlite\.db|Failed to fetch/.test(loadError) ? (
              <>
                Could not fetch <code>sqlite.db</code> from the deployed site
                — check your network or that the gallery has been deployed.
              </>
            ) : (
              loadError
            )}
          </div>
        )}

        {!loadError && entries == null && (
          <div className="hint">Loading sqlite.db from deployed site…</div>
        )}

        {entries && entries.length === 0 && !loadError && (
          <div className="empty-block">
            <p>No years with photos in this gallery yet.</p>
          </div>
        )}

        {entries && entries.length > 0 && (
          <ul className="years">
            {entries.map((e) => (
              <li key={e.year}>
                <Link
                  href={`${galleryHref}/annual-summary/${e.year}` as any}
                  className="year-card"
                >
                  <div className="year">{e.year}</div>
                  <div className="status">
                    {e.saved ? (
                      <span className="badge filled">已保存</span>
                    ) : (
                      <span className="badge empty">未保存</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 880px; margin: 0 auto; }

        .hero { margin-bottom: 32px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 48px;
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
          color: var(--text-muted);
        }
        .meta code {
          background: var(--bg-card);
          padding: 1px 6px;
          border-radius: 4px;
          color: var(--text);
        }

        .hint {
          padding: 56px 24px;
          text-align: center;
          color: var(--text-muted);
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .empty-block {
          padding: 56px 24px;
          text-align: center;
          color: var(--text-muted);
          border: 1px dashed var(--border-strong);
          border-radius: 14px;
        }
        .empty-block p { margin: 0; }

        .years {
          list-style: none; margin: 0; padding: 0;
          display: grid; gap: 12px;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        }
      `}</style>
    </div>
  );
}
