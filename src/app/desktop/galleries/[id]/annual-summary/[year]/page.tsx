'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type LocalGallery,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { useAdapterImage } from '@/components/desktop/useAdapterImage';
import { fireUndoToast } from '@/components/desktop/UndoToast';
import {
  loadAnnualSummary,
  openDeployedGalleryDb,
  saveAnnualSummary,
} from '@/components/desktop/galleryDb';
import {
  listMonthlyCandidates,
  type AnnualSummary,
  type CandidatePhoto,
  type MonthKey,
  type MonthlyCandidates,
} from '@/lib/annualSummary';

const MONTH_LABEL: Record<MonthKey, string> = {
  '01': '一月',
  '02': '二月',
  '03': '三月',
  '04': '四月',
  '05': '五月',
  '06': '六月',
  '07': '七月',
  '08': '八月',
  '09': '九月',
  '10': '十月',
  '11': '十一月',
  '12': '十二月',
};

const ALL_MONTHS: MonthKey[] = [
  '01', '02', '03', '04', '05', '06',
  '07', '08', '09', '10', '11', '12',
];

const draftKey = (galleryId: string, year: string) =>
  `desktopAnnualSummaryDraft:${galleryId}:${year}`;

export default function AnnualSummaryPicker() {
  const router = useRouter();
  const params = useParams<{ id: string; year: string }>();
  const galleryId = params?.id;
  const year = params?.year;

  const [bridge, setBridge] = useState<PicgBridge | null>(null);
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [candidates, setCandidates] = useState<MonthlyCandidates | null>(null);
  const [months, setMonths] = useState<MonthKey[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [selections, setSelections] = useState<AnnualSummary>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    if (!adapter || !year || !galleryId) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await openDeployedGalleryDb(adapter);
        if (cancelled) return;
        const cands = listMonthlyCandidates(db, year);
        const presentMonths = ALL_MONTHS.filter(
          (m) => (cands[m]?.length ?? 0) > 0
        );
        setCandidates(cands);
        setMonths(presentMonths);

        // Prefer in-progress draft over the saved file when both exist.
        const existing = await loadAnnualSummary(adapter, year);
        let initial: AnnualSummary = existing ?? {};
        try {
          const raw = sessionStorage.getItem(draftKey(galleryId, year));
          if (raw) initial = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        setSelections(initial);
        setStepIdx(0);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, year, galleryId]);

  // Persist draft on every change so a refresh doesn't lose user picks.
  useEffect(() => {
    if (!galleryId || !year || !candidates) return;
    try {
      sessionStorage.setItem(draftKey(galleryId, year), JSON.stringify(selections));
    } catch {
      /* ignore */
    }
  }, [selections, galleryId, year, candidates]);

  const currentMonth = months[stepIdx];
  const candidatesForMonth: CandidatePhoto[] =
    currentMonth && candidates ? candidates[currentMonth] ?? [] : [];

  const completedCount = useMemo(
    () => months.filter((m) => selections[m]).length,
    [months, selections]
  );

  function pick(path: string) {
    if (!currentMonth) return;
    setSelections((s) => ({ ...s, [currentMonth]: path }));
  }

  function clearMonth() {
    if (!currentMonth) return;
    setSelections((s) => {
      const next = { ...s };
      delete next[currentMonth];
      return next;
    });
  }

  async function submit() {
    if (!adapter || !year || !gallery || !galleryId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveAnnualSummary(adapter, year, selections);
      fireUndoToast({
        galleryId: gallery.id,
        message: `Saved ${year} annual summary`,
      });
      try {
        sessionStorage.removeItem(draftKey(galleryId, year));
      } catch {
        /* ignore */
      }
      // Cross-route hard nav (see docs/desktop-development.md §2.1).
      const href = `/desktop/galleries/${encodeURIComponent(gallery.id)}/annual-summary?t=${Date.now()}`;
      if (typeof window !== 'undefined') {
        window.location.assign(href);
      } else {
        router.push(href as any);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  if (!bridge) {
    return (
      <div className="page">
        <main className="empty"><h1>Desktop only</h1></main>
        <DesktopTheme />
      </div>
    );
  }
  if (!gallery || !year) {
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
  const isLastStep = stepIdx === months.length - 1;

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href={`${galleryHref}/annual-summary` as any} className="picg-back-link">
          ← Annual summary
        </Link>

        <section className="hero">
          <h1>{year} 年度精选</h1>
          <p className="meta">
            {candidates == null
              ? 'Loading sqlite.db from deployed site…'
              : months.length === 0
                ? 'No photos with EXIF date in this year.'
                : `${completedCount} / ${months.length} months filled`}
          </p>
        </section>

        {loadError && <div className="picg-banner">{loadError}</div>}

        {candidates && months.length > 0 && currentMonth && (
          <>
            <nav className="month-tabs">
              {months.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className={`tab ${i === stepIdx ? 'active' : ''} ${
                    selections[m] ? 'done' : ''
                  }`}
                  onClick={() => setStepIdx(i)}
                >
                  {MONTH_LABEL[m]}
                  {selections[m] && <span className="dot" />}
                </button>
              ))}
            </nav>

            <div className="step-info">
              <h2>
                {MONTH_LABEL[currentMonth]} · {candidatesForMonth.length} 张候选
              </h2>
              {selections[currentMonth] && (
                <p className="picked">
                  已选：<code>{selections[currentMonth]}</code>
                </p>
              )}
            </div>

            <ul className="picg-thumbs">
              {candidatesForMonth.map((p) => (
                <PickerThumb
                  key={p.path}
                  adapter={adapter}
                  candidate={p}
                  galleryId={gallery.id}
                  isPicked={selections[currentMonth] === p.path}
                  onPick={() => pick(p.path)}
                />
              ))}
            </ul>

            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                disabled={stepIdx === 0 || saving}
              >
                上一月
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={clearMonth}
                disabled={saving || !selections[currentMonth]}
              >
                清除本月
              </button>
              <div className="actions-spacer" />
              {!isLastStep ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setStepIdx((i) => i + 1)}
                  disabled={saving}
                >
                  下一月
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={submit}
                  disabled={saving || completedCount === 0}
                >
                  {saving ? 'Saving…' : `Save ${completedCount} pick${completedCount === 1 ? '' : 's'}`}
                </button>
              )}
            </div>

            {saveError && <div className="picg-banner">{saveError}</div>}
          </>
        )}
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1200px; margin: 0 auto; }

        .hero { margin-bottom: 24px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 44px;
          font-weight: 400;
          letter-spacing: -0.01em;
          margin: 0 0 6px;
          color: var(--text);
        }
        .meta {
          margin: 0;
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .month-tabs {
          display: flex; flex-wrap: wrap; gap: 4px;
          margin-bottom: 16px;
        }
        .tab {
          position: relative;
          padding: 6px 12px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 999px;
          color: var(--text-muted);
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .tab:hover { color: var(--text); border-color: var(--border-strong); }
        .tab.active {
          background: var(--accent);
          color: var(--accent-text);
          border-color: var(--accent);
        }
        .tab.done:not(.active) { color: var(--text); }
        .tab .dot {
          display: inline-block;
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--accent);
          margin-left: 6px;
          vertical-align: middle;
        }
        .tab.active .dot { background: var(--accent-text); }

        .step-info { margin-bottom: 14px; }
        .step-info h2 {
          font-family: var(--serif);
          font-size: 22px;
          font-weight: 400;
          margin: 0 0 4px;
          color: var(--text);
        }
        .picked {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          margin: 0;
        }
        .picked code {
          background: var(--bg-card);
          padding: 1px 6px;
          border-radius: 4px;
          color: var(--text);
        }

        .actions {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 16px 0;
          border-top: 1px solid var(--border);
          margin-top: 24px;
          position: sticky;
          bottom: 0;
          background: var(--bg);
        }
        .actions-spacer { flex: 1; }
      `}</style>
    </div>
  );
}

function PickerThumb({
  adapter,
  candidate,
  galleryId,
  isPicked,
  onPick,
}: {
  adapter: StorageAdapter | null;
  candidate: CandidatePhoto;
  galleryId: string;
  isPicked: boolean;
  onPick: () => void;
}) {
  const { src } = useAdapterImage(adapter, candidate.path, {
    picgGalleryId: galleryId,
  });
  return (
    <li>
      <button
        type="button"
        className={`picg-thumb ${isPicked ? 'is-cover' : ''}`}
        onClick={onPick}
        aria-label={candidate.path}
        aria-pressed={isPicked}
      >
        {src ? <img src={src} alt={candidate.name} loading="lazy" /> : <div className="picg-thumb-placeholder" />}
      </button>
    </li>
  );
}
