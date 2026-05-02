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
import { openDeployedGalleryDb } from '@/components/desktop/galleryDb';
import {
  parseGalleryConfig,
  thumbnailUrlFor,
  type GalleryUrlConfig,
} from '@/lib/annualSummary';
import {
  loadGalleryStats,
  type CountRow,
  type GalleryStatsSnapshot,
  type HeatmapYear,
} from '@/lib/galleryStats';

export default function GalleryStatsPage() {
  const params = useParams<{ id: string }>();
  const galleryId = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [stats, setStats] = useState<GalleryStatsSnapshot | null>(null);
  const [cfg, setCfg] = useState<GalleryUrlConfig | null>(null);
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
          new PreloadBridgeAdapter({ repoPath: g.localPath, bridge: bridge.storage }),
        );
      }
    });
  }, [bridge, galleryId]);

  useEffect(() => {
    if (!adapter) return;
    let cancelled = false;
    (async () => {
      try {
        const file = await adapter.readFile('CONFIG.yml');
        const parsed = parseGalleryConfig(file.text());
        const db = await openDeployedGalleryDb(adapter);
        if (cancelled) return;
        setCfg(parsed);
        setStats(loadGalleryStats(db));
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
          <h1>Statistics</h1>
          <p className="meta">
            Snapshot from the last deployed build of this gallery. Photos added
            locally but not yet pushed will appear after the next CI run.
          </p>
        </section>

        {loadError && (
          <div className="picg-banner">
            {/CONFIG\.yml|url 字段/.test(loadError) ? (
              <>
                <code>CONFIG.yml</code> doesn&apos;t have a <code>url</code> field
                — statistics read <code>sqlite.db</code> from the deployed site,
                so the gallery has to be deployed at least once first.
              </>
            ) : /sqlite\.db|Failed to fetch/.test(loadError) ? (
              <>
                Could not fetch <code>sqlite.db</code> from the deployed site —
                check your network or that the gallery has been deployed.
              </>
            ) : (
              loadError
            )}
          </div>
        )}

        {!loadError && stats == null && (
          <div className="hint">Loading sqlite.db from deployed site…</div>
        )}

        {stats && (
          <>
            <section className="overview">
              <Card label="Total photos" value={stats.totalPhotos} />
              <Card label="Live Photos" value={stats.livePhotos} />
              <Card label="Cameras" value={stats.makers.length} />
              <Card label="Lenses (top 10)" value={stats.lenses.length} />
            </section>

            {stats.heatmap.length > 0 && (
              <section className="heatmap-section">
                <h2>Photos per day</h2>
                <p className="section-meta">
                  Daily activity across each year. Cell intensity scales with that
                  year&apos;s busiest day.
                </p>
                <div className="heatmap-stack">
                  {stats.heatmap.map((y) => (
                    <Heatmap key={y.year} year={y} />
                  ))}
                </div>
              </section>
            )}

            <div className="grid">
              <StatList title="Camera makers" rows={stats.makers} />
              <StatList title="Top lenses" rows={stats.lenses} />
              <StatList title="Top focal lengths" rows={stats.focalLengths} />
              <StatList title="Top apertures" rows={stats.apertures} />
              <StatList title="Top shutter speeds" rows={stats.exposureTimes} />
              <StatList title="Countries" rows={stats.countries} />
            </div>

            {stats.todayInHistory.length > 0 && cfg && (
              <section className="today">
                <h2>On this day in history</h2>
                <p className="section-meta">
                  {stats.todayInHistory.length} photo
                  {stats.todayInHistory.length === 1 ? '' : 's'} taken on this
                  month/day across past years.
                </p>
                <ul className="thumbs">
                  {stats.todayInHistory.map((p) => (
                    <li key={p.path}>
                      <img
                        src={thumbnailUrlFor(cfg, p.path)}
                        alt={p.name}
                        loading="lazy"
                      />
                      <div className="caption">{p.date}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1080px; margin: 0 auto; }

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
          max-width: 640px;
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

        .overview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 32px;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
          gap: 24px;
          margin-bottom: 40px;
        }

        .heatmap-section { margin-bottom: 40px; }
        .heatmap-section h2 {
          font-family: var(--serif);
          font-size: 24px;
          font-weight: 400;
          margin: 0 0 6px;
          color: var(--text);
        }
        .heatmap-stack {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .today { margin-top: 8px; }
        .today h2 {
          font-family: var(--serif);
          font-size: 24px;
          font-weight: 400;
          margin: 0 0 6px;
          color: var(--text);
        }
        .section-meta {
          margin: 0 0 16px;
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          color: var(--text-muted);
        }
        .thumbs {
          list-style: none; margin: 0; padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 8px;
        }
        .thumbs li {
          position: relative;
          aspect-ratio: 1 / 1;
          background: var(--bg-card);
          border-radius: 8px;
          overflow: hidden;
        }
        .thumbs img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .thumbs .caption {
          position: absolute;
          left: 6px;
          bottom: 6px;
          padding: 2px 6px;
          background: rgba(0, 0, 0, 0.55);
          color: #fff;
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: 0.05em;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="value">{value.toLocaleString()}</div>
      <div className="label">{label}</div>
      <style jsx>{`
        .card {
          padding: 18px 20px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .value {
          font-family: var(--serif);
          font-size: 32px;
          font-weight: 400;
          color: var(--text);
          line-height: 1.1;
        }
        .label {
          margin-top: 6px;
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

function StatList({ title, rows }: { title: string; rows: CountRow[] }) {
  const max = rows.reduce((m, r) => (r.count > m ? r.count : m), 0);
  return (
    <section className="stat-list">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="empty">No data.</p>
      ) : (
        <ul>
          {rows.map((r) => {
            const pct = max > 0 ? Math.max(2, Math.round((r.count / max) * 100)) : 0;
            return (
              <li key={r.label}>
                <div className="row">
                  <span className="label" title={r.label}>{r.label}</span>
                  <span className="count">{r.count.toLocaleString()}</span>
                </div>
                <div className="bar"><span style={{ width: `${pct}%` }} /></div>
              </li>
            );
          })}
        </ul>
      )}
      <style jsx>{`
        .stat-list {
          padding: 18px 20px 14px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        h2 {
          margin: 0 0 12px;
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 500;
        }
        .empty {
          margin: 0;
          font-family: var(--mono);
          font-size: 12px;
          color: var(--text-muted);
        }
        ul { list-style: none; margin: 0; padding: 0; }
        li { padding: 6px 0; }
        li + li { border-top: 1px solid var(--border); }
        .row {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 12px; margin-bottom: 4px;
        }
        .label {
          font-size: 13px;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .count {
          font-family: var(--mono);
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.04em;
        }
        .bar {
          height: 3px;
          background: var(--border);
          border-radius: 2px;
          overflow: hidden;
        }
        .bar span {
          display: block;
          height: 100%;
          background: var(--text);
          transition: width 0.3s ease;
        }
      `}</style>
    </section>
  );
}

function gridPosition(dateStr: string): { col: number; row: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const start = new Date(Date.UTC(y, 0, 1));
  const startDow = start.getUTCDay();
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return {
    col: Math.floor((dayOfYear + startDow) / 7),
    row: date.getUTCDay(),
  };
}

function intensityLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Heatmap({ year }: { year: HeatmapYear }) {
  const total = year.days.reduce((s, d) => s + d.count, 0);
  const cells = year.days
    .map((d) => {
      const pos = gridPosition(d.date);
      if (!pos) return null;
      return {
        date: d.date,
        count: d.count,
        col: pos.col,
        row: pos.row,
        level: intensityLevel(d.count, year.max),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const maxCol = cells.reduce((m, c) => (c.col > m ? c.col : m), 0);
  const cols = maxCol + 1;

  // month labels: column where each month's first day lands
  const monthCols: Array<{ col: number; label: string }> = [];
  for (let mo = 0; mo < 12; mo++) {
    const pos = gridPosition(
      `${year.year}-${String(mo + 1).padStart(2, '0')}-01`,
    );
    if (pos) monthCols.push({ col: pos.col, label: MONTH_LABELS[mo] });
  }

  return (
    <div className="heatmap">
      <div className="head">
        <span className="year">{year.year}</span>
        <span className="total">
          {total.toLocaleString()} photo{total === 1 ? '' : 's'} · peak{' '}
          {year.max.toLocaleString()}/day
        </span>
      </div>
      <div className="scroll">
        <div className="months" style={{ gridTemplateColumns: `repeat(${cols}, 12px)` }}>
          {monthCols.map((m) => (
            <span key={m.label} style={{ gridColumn: m.col + 1 }}>
              {m.label}
            </span>
          ))}
        </div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, 12px)`,
            gridTemplateRows: 'repeat(7, 12px)',
          }}
        >
          {cells.map((c) => (
            <div
              key={c.date}
              className={`cell lvl${c.level}`}
              style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }}
              title={`${c.date} · ${c.count} photo${c.count === 1 ? '' : 's'}`}
            />
          ))}
        </div>
      </div>
      <style jsx>{`
        .heatmap {
          padding: 16px 20px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .year {
          font-family: var(--serif);
          font-size: 20px;
          color: var(--text);
        }
        .total {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          color: var(--text-muted);
        }
        .scroll {
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .months {
          display: grid;
          gap: 2px;
          margin-bottom: 4px;
          height: 12px;
        }
        .months span {
          font-family: var(--mono);
          font-size: 9px;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          line-height: 12px;
          grid-row: 1;
        }
        .grid {
          display: grid;
          gap: 2px;
        }
        .cell {
          width: 12px;
          height: 12px;
          border-radius: 2px;
          background: var(--border);
        }
        .cell.lvl1 { background: rgba(232, 160, 74, 0.28); }
        .cell.lvl2 { background: rgba(232, 160, 74, 0.5); }
        .cell.lvl3 { background: rgba(232, 160, 74, 0.75); }
        .cell.lvl4 { background: rgba(232, 160, 74, 1); }
      `}</style>
    </div>
  );
}
