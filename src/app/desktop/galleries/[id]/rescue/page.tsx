'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getCompressionSettings } from '@/lib/settings';
import {
  scanOversizedPhotos,
  predictedOutputPath,
  extensionWillChange,
  rewriteCoverPaths,
  findCoverReferences,
  formatBytes,
  type OversizedPhoto,
} from '@/lib/galleryRescue';

// Memory-only result staging. If the user runs into RAM pressure on
// huge batches we can extend CompressedResult with a `stagedPath` and
// add a main-side IPC that writes to <userData>/rescue-staging/<sid>/
// — the page-level state machine doesn't need to change.
type CompressedResult = {
  source: OversizedPhoto;
  status: 'ok' | 'skipped-no-gain' | 'error';
  newName?: string;
  newPath?: string;
  newSize?: number;
  buffer?: Uint8Array;
  blobUrl?: string;
  blobMime?: string;
  error?: string;
};

type Phase =
  | 'init'
  | 'scanning'
  | 'pick'
  | 'compressing'
  | 'review'
  | 'applying'
  | 'done'
  | 'error';

const SCAN_FLOOR_MB = 1;          // scan returns photos >= this
const DEFAULT_THRESHOLD_MB = 10;  // default slider position
const MAX_THRESHOLD_MB = 100;

export default function GalleryRescuePage() {
  const params = useParams<{ id: string }>();
  const galleryId = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [phase, setPhase] = useState<Phase>('init');
  const [phaseError, setPhaseError] = useState<string | null>(null);

  const [allCandidates, setAllCandidates] = useState<OversizedPhoto[]>([]);
  const [thresholdMb, setThresholdMb] = useState(DEFAULT_THRESHOLD_MB);
  const [scanProgress, setScanProgress] = useState<{ idx: number; total: number; name: string } | null>(null);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [coverRefs, setCoverRefs] = useState<Set<string>>(new Set());

  const [compressing, setCompressing] = useState<{ done: number; total: number; current?: string } | null>(null);
  const [results, setResults] = useState<CompressedResult[]>([]);
  const [applyChoices, setApplyChoices] = useState<Map<string, boolean>>(new Map());
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const [applyReport, setApplyReport] = useState<{
    replaced: number;
    deletedOriginals: number;
    coverRewrites: number;
    failed: Array<{ path: string; error: string }>;
  } | null>(null);

  const cancelRef = useRef(false);
  const settingsRef = useRef(getCompressionSettings());
  // Effective output format — rescue mode forces lossless off (decision #2).
  // We don't write back to localStorage, this is just for the in-flight run.
  const effectiveSettings = useMemo(() => ({ ...settingsRef.current, lossless: false }), []);
  const outputFormat = effectiveSettings.outputFormat;

  // Boot
  useEffect(() => { setBridge(getPicgBridge()); }, []);

  useEffect(() => {
    if (!bridge || !galleryId) return;
    bridge.gallery.resolve(galleryId).then((g) => {
      setGallery(g);
      if (g) {
        setAdapter(new PreloadBridgeAdapter({ repoPath: g.localPath, bridge: bridge.storage }));
      }
    });
  }, [bridge, galleryId]);

  // Stage 1 — scan
  useEffect(() => {
    if (!adapter || phase !== 'init') return;
    setPhase('scanning');
    setScanProgress(null);
    let cancelled = false;
    (async () => {
      try {
        const readme = await adapter.readFile('README.yml');
        const refs = findCoverReferences(readme.text());
        if (cancelled) return;
        setCoverRefs(refs);

        const found = await scanOversizedPhotos(
          adapter,
          SCAN_FLOOR_MB * 1024 * 1024,
          (p) => {
            if (!cancelled) {
              setScanProgress({ idx: p.albumIndex + 1, total: p.albumCount, name: p.albumName });
            }
          },
        );
        if (cancelled) return;
        setAllCandidates(found);
        setPhase('pick');
      } catch (err) {
        if (!cancelled) {
          setPhaseError(err instanceof Error ? err.message : String(err));
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [adapter, phase]);

  // Filter candidates by threshold and re-default-select on threshold change
  const candidates = useMemo(
    () => allCandidates.filter((p) => p.size >= thresholdMb * 1024 * 1024),
    [allCandidates, thresholdMb],
  );

  useEffect(() => {
    if (phase !== 'pick') return;
    setPicks(new Set(candidates.map((p) => p.path)));
  }, [phase, candidates]);

  // Stage 2 — compress
  const startCompress = useCallback(async () => {
    if (!bridge || !adapter) return;
    const queue = candidates.filter((p) => picks.has(p.path));
    if (queue.length === 0) return;
    cancelRef.current = false;
    setResults([]);
    setCompressing({ done: 0, total: queue.length });
    setPhase('compressing');

    const out: CompressedResult[] = [];
    for (let i = 0; i < queue.length; i++) {
      if (cancelRef.current) break;
      const src = queue[i];
      setCompressing({ done: i, total: queue.length, current: src.path });
      try {
        const file = await adapter.readFile(src.path);
        if (cancelRef.current) break;
        const result = await bridge.compress.image({
          bytes: file.data,
          originalName: src.fileName,
          outputFormat: effectiveSettings.outputFormat,
          preserveExif: effectiveSettings.preserveEXIF,
          lossless: false,
          quality: effectiveSettings.quality,
          webpEffort: effectiveSettings.webpEffort,
          maxMegapixels: effectiveSettings.maxMegapixels,
        });
        if (result.buffer.byteLength >= src.size) {
          out.push({ source: src, status: 'skipped-no-gain', newSize: result.buffer.byteLength });
          continue;
        }
        const newPath = `${src.albumUrl}/${result.name}`;
        const blob = new Blob([result.buffer], { type: result.type });
        const blobUrl = URL.createObjectURL(blob);
        out.push({
          source: src,
          status: 'ok',
          newName: result.name,
          newPath,
          newSize: result.buffer.byteLength,
          buffer: result.buffer,
          blobUrl,
          blobMime: result.type,
        });
      } catch (err) {
        out.push({
          source: src,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (cancelRef.current) {
      // Revoke any blob URLs we accumulated before bailing.
      for (const r of out) if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
      setResults([]);
      setCompressing(null);
      setPhase('pick');
      return;
    }

    setResults(out);
    const choices = new Map<string, boolean>();
    for (const r of out) if (r.status === 'ok') choices.set(r.source.path, true);
    setApplyChoices(choices);
    setCompressing(null);
    setPhase('review');
  }, [bridge, adapter, candidates, picks, effectiveSettings]);

  const cancelCompress = useCallback(() => {
    cancelRef.current = true;
  }, []);

  // Stage 4 — apply
  const startApply = useCallback(async () => {
    if (!adapter) return;
    cancelRef.current = false;
    const toApply = results.filter((r) => r.status === 'ok' && applyChoices.get(r.source.path));
    if (toApply.length === 0) return;
    setApplyProgress({ done: 0, total: toApply.length });
    setPhase('applying');

    const failed: Array<{ path: string; error: string }> = [];
    let replaced = 0;
    let deletedOriginals = 0;
    const coverMapping = new Map<string, string>();

    for (let i = 0; i < toApply.length; i++) {
      const r = toApply[i];
      setApplyProgress({ done: i, total: toApply.length });
      const src = r.source;
      const newPath = r.newPath!;
      const buffer = r.buffer!;
      const extChanged = extensionWillChange(src.path, outputFormat);
      const message = `Rescue: compress ${src.path}`;
      try {
        await adapter.writeFile(newPath, buffer, message);
        replaced++;
        if (extChanged) {
          try {
            await adapter.deleteFile(src.path, `Rescue: drop original ${src.path}`);
            deletedOriginals++;
          } catch (err) {
            failed.push({
              path: src.path,
              error: `wrote ${newPath} but failed to delete original: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
          if (coverRefs.has(src.path)) {
            coverMapping.set(src.path, newPath);
          }
        }
      } catch (err) {
        failed.push({ path: src.path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    let coverRewrites = 0;
    if (coverMapping.size > 0) {
      try {
        const readme = await adapter.readFile('README.yml');
        const { text, rewrites } = rewriteCoverPaths(readme.text(), coverMapping);
        coverRewrites = rewrites.length;
        if (coverRewrites > 0) {
          await adapter.writeFile('README.yml', text, `Rescue: update cover refs (${coverRewrites})`);
        }
      } catch (err) {
        failed.push({
          path: 'README.yml',
          error: `cover-ref rewrite failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    setApplyReport({ replaced, deletedOriginals, coverRewrites, failed });
    setApplyProgress(null);
    setPhase('done');
  }, [adapter, results, applyChoices, coverRefs, outputFormat]);

  // Cleanup blob URLs on unmount or when results are replaced
  useEffect(() => {
    return () => {
      for (const r of results) if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
    };
  }, [results]);

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
          <h1>Rescue oversized photos</h1>
          <p className="meta">
            Scans every album for large source photos and re-compresses them
            with your current compression settings (lossless temporarily off).
            You&apos;ll review every result before anything is written back.
          </p>
        </section>

        {phase === 'error' && phaseError && (
          <div className="picg-banner">{phaseError}</div>
        )}

        {phase === 'scanning' && (
          <ScanningView progress={scanProgress} />
        )}

        {phase === 'pick' && (
          <PickerView
            galleryId={gallery.id}
            allCount={allCandidates.length}
            candidates={candidates}
            picks={picks}
            setPicks={setPicks}
            thresholdMb={thresholdMb}
            setThresholdMb={setThresholdMb}
            outputFormat={outputFormat}
            coverRefs={coverRefs}
            onCompress={startCompress}
          />
        )}

        {phase === 'compressing' && (
          <CompressingView progress={compressing} onCancel={cancelCompress} />
        )}

        {phase === 'review' && (
          <ReviewView
            galleryId={gallery.id}
            results={results}
            applyChoices={applyChoices}
            setApplyChoices={setApplyChoices}
            outputFormat={outputFormat}
            onApply={startApply}
            onBack={() => {
              for (const r of results) if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
              setResults([]);
              setApplyChoices(new Map());
              setPhase('pick');
            }}
          />
        )}

        {phase === 'applying' && (
          <ApplyingView progress={applyProgress} />
        )}

        {phase === 'done' && applyReport && (
          <DoneView report={applyReport} galleryHref={galleryHref} />
        )}
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1080px; margin: 0 auto; }
        .hero { margin-bottom: 24px; }
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
      `}</style>
    </div>
  );
}

function ScanningView({ progress }: { progress: { idx: number; total: number; name: string } | null }) {
  return (
    <div className="hint">
      Scanning albums…
      {progress && (
        <span className="prog">
          {' '}({progress.idx}/{progress.total}) {progress.name}
        </span>
      )}
      <style jsx>{`
        .hint {
          padding: 56px 24px;
          text-align: center;
          color: var(--text-muted);
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .prog { color: var(--text); }
      `}</style>
    </div>
  );
}

function PickerView({
  galleryId,
  allCount,
  candidates,
  picks,
  setPicks,
  thresholdMb,
  setThresholdMb,
  outputFormat,
  coverRefs,
  onCompress,
}: {
  galleryId: string;
  allCount: number;
  candidates: OversizedPhoto[];
  picks: Set<string>;
  setPicks: (next: Set<string>) => void;
  thresholdMb: number;
  setThresholdMb: (mb: number) => void;
  outputFormat: 'webp' | 'jpeg';
  coverRefs: Set<string>;
  onCompress: () => void;
}) {
  const totalSize = useMemo(
    () => candidates.filter((p) => picks.has(p.path)).reduce((s, p) => s + p.size, 0),
    [candidates, picks],
  );

  const toggleAll = () => {
    if (picks.size === candidates.length) setPicks(new Set());
    else setPicks(new Set(candidates.map((p) => p.path)));
  };
  const togglePath = (p: string) => {
    const next = new Set(picks);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPicks(next);
  };

  const allChecked = picks.size === candidates.length && candidates.length > 0;

  return (
    <>
      <div className="threshold">
        <label>
          <span className="lbl">Threshold</span>
          <input
            type="range"
            min={SCAN_FLOOR_MB}
            max={MAX_THRESHOLD_MB}
            step={1}
            value={thresholdMb}
            onChange={(e) => setThresholdMb(Number(e.target.value))}
          />
          <span className="val">≥ {thresholdMb} MB</span>
        </label>
        <span className="count">
          {candidates.length} of {allCount} photo{allCount === 1 ? '' : 's'} ≥ {SCAN_FLOOR_MB} MB
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="empty-block">
          <p>No photos at or above {thresholdMb} MB.</p>
          <p className="hint">Try lowering the threshold.</p>
        </div>
      ) : (
        <>
          <div className="action-bar top">
            <label className="all">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              <span>{picks.size} selected · {formatBytes(totalSize)}</span>
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={picks.size === 0}
              onClick={onCompress}
            >
              Compress {picks.size} photo{picks.size === 1 ? '' : 's'}
            </button>
          </div>

          <ul className="cards">
            {candidates.map((p) => {
              const checked = picks.has(p.path);
              const extChange = extensionWillChange(p.path, outputFormat);
              const isCover = coverRefs.has(p.path);
              return (
                <li key={p.path}>
                  <label className="card">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePath(p.path)}
                    />
                    <img
                      src={`picg://gallery/${encodeURIComponent(galleryId)}/${p.path
                        .split('/')
                        .map(encodeURIComponent)
                        .join('/')}?thumb=320`}
                      alt={p.fileName}
                      loading="lazy"
                    />
                    <div className="info">
                      <div className="name" title={p.path}>{p.fileName}</div>
                      <div className="album">{p.albumName}</div>
                      <div className="size">{formatBytes(p.size)}</div>
                      <div className="badges">
                        {extChange && (
                          <span
                            className="badge warn"
                            title={`Will be renamed to ${predictedOutputPath(p.path, outputFormat).split('/').pop()}`}
                          >
                            ⚠ {p.ext} → {outputFormat === 'jpeg' ? '.jpg' : '.webp'}
                          </span>
                        )}
                        {isCover && (
                          <span className="badge cover" title="This photo is a cover; the cover ref will be rewritten on apply.">
                            cover
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <style jsx>{`
        .threshold {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 20px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          margin-bottom: 16px;
        }
        .threshold label {
          display: flex; align-items: center; gap: 12px;
          flex: 1; max-width: 480px;
        }
        .threshold .lbl {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .threshold input[type='range'] { flex: 1; accent-color: var(--accent); }
        .threshold .val {
          font-family: var(--mono);
          font-size: 13px;
          color: var(--text);
          min-width: 80px;
          text-align: right;
        }
        .threshold .count {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-muted);
        }

        .empty-block {
          padding: 56px 24px; text-align: center; color: var(--text-muted);
          border: 1px dashed var(--border-strong); border-radius: 14px;
        }
        .empty-block p { margin: 0; }
        .empty-block .hint { margin-top: 6px; font-size: 12px; }

        .action-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .action-bar.top { margin-bottom: 16px; }
        .all { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .all span {
          font-family: var(--mono);
          font-size: 12px;
          color: var(--text);
          letter-spacing: 0.04em;
        }

        .cards {
          list-style: none; margin: 0; padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 12px;
        }
        .card {
          display: flex; flex-direction: column; gap: 8px;
          padding: 10px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 10px;
          cursor: pointer;
          position: relative;
        }
        .card input[type='checkbox'] {
          position: absolute; top: 14px; left: 14px;
          width: 16px; height: 16px;
          accent-color: var(--accent);
        }
        .card img {
          width: 100%;
          aspect-ratio: 1 / 1;
          object-fit: cover;
          border-radius: 6px;
          background: var(--bg);
        }
        .info { padding: 0 4px; }
        .name {
          font-size: 13px;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .album {
          font-family: var(--mono);
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 0.05em;
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .size {
          font-family: var(--mono);
          font-size: 12px;
          color: var(--accent);
          margin-top: 4px;
        }
        .badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
        .badge {
          font-family: var(--mono);
          font-size: 9px;
          letter-spacing: 0.06em;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .badge.warn {
          background: rgba(232, 160, 74, 0.15);
          color: var(--accent);
          border: 1px solid rgba(232, 160, 74, 0.4);
        }
        .badge.cover {
          background: var(--bg-card-hover);
          color: var(--text-muted);
          border: 1px solid var(--border-strong);
        }
      `}</style>
    </>
  );
}

function CompressingView({
  progress,
  onCancel,
}: {
  progress: { done: number; total: number; current?: string } | null;
  onCancel: () => void;
}) {
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  return (
    <div className="wrap">
      <div className="head">
        <span>Compressing {progress?.done ?? 0} / {progress?.total ?? 0}</span>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      {progress?.current && (
        <div className="cur" title={progress.current}>{progress.current}</div>
      )}
      <style jsx>{`
        .wrap {
          padding: 32px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .head {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 14px;
          font-family: var(--mono);
          font-size: 13px;
          color: var(--text);
        }
        .bar {
          height: 4px;
          background: var(--border);
          border-radius: 2px;
          overflow: hidden;
        }
        .bar span {
          display: block;
          height: 100%;
          background: var(--accent);
          transition: width 0.2s ease;
        }
        .cur {
          margin-top: 12px;
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

function ReviewView({
  galleryId,
  results,
  applyChoices,
  setApplyChoices,
  outputFormat,
  onApply,
  onBack,
}: {
  galleryId: string;
  results: CompressedResult[];
  applyChoices: Map<string, boolean>;
  setApplyChoices: (next: Map<string, boolean>) => void;
  outputFormat: 'webp' | 'jpeg';
  onApply: () => void;
  onBack: () => void;
}) {
  const ok = results.filter((r) => r.status === 'ok');
  const skipped = results.filter((r) => r.status === 'skipped-no-gain');
  const errored = results.filter((r) => r.status === 'error');

  const [zoomIdx, setZoomIdx] = useState<number | null>(null);

  const toggleApply = (path: string) => {
    const next = new Map(applyChoices);
    next.set(path, !next.get(path));
    setApplyChoices(next);
  };
  const setAllApply = (val: boolean) => {
    const next = new Map<string, boolean>();
    for (const r of ok) next.set(r.source.path, val);
    setApplyChoices(next);
  };

  const applyCount = Array.from(applyChoices.values()).filter(Boolean).length;
  const savedBytes = useMemo(() => {
    let s = 0;
    for (const r of ok) {
      if (applyChoices.get(r.source.path)) {
        s += r.source.size - (r.newSize ?? r.source.size);
      }
    }
    return s;
  }, [ok, applyChoices]);

  return (
    <>
      <div className="summary">
        <div>
          <strong>{ok.length}</strong> compressed
          {skipped.length > 0 && <> · <span className="muted">{skipped.length} skipped (no gain)</span></>}
          {errored.length > 0 && <> · <span className="bad">{errored.length} failed</span></>}
        </div>
        <div className="actions">
          <button type="button" className="btn ghost small" onClick={onBack}>
            Back to picker
          </button>
          <button type="button" className="btn ghost small" onClick={() => setAllApply(true)}>
            Replace all
          </button>
          <button type="button" className="btn ghost small" onClick={() => setAllApply(false)}>
            Keep all
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={applyCount === 0}
            onClick={onApply}
          >
            Apply {applyCount} replacement{applyCount === 1 ? '' : 's'} · save {formatBytes(Math.max(0, savedBytes))}
          </button>
        </div>
      </div>

      {ok.length > 0 && (
        <ul className="cards">
          {ok.map((r, i) => {
            const willApply = applyChoices.get(r.source.path) ?? false;
            const reduction = 1 - (r.newSize ?? r.source.size) / r.source.size;
            return (
              <li key={r.source.path}>
                <div className={`card ${willApply ? 'on' : 'off'}`}>
                  <div
                    className="thumbs"
                    onClick={() => setZoomIdx(i)}
                    role="button"
                    tabIndex={0}
                  >
                    <img
                      src={`picg://gallery/${encodeURIComponent(galleryId)}/${r.source.path
                        .split('/')
                        .map(encodeURIComponent)
                        .join('/')}?thumb=320`}
                      alt="before"
                    />
                    <span className="arrow">→</span>
                    <img src={r.blobUrl} alt="after" />
                  </div>
                  <div className="meta">
                    <div className="name" title={r.source.path}>{r.source.fileName}</div>
                    {r.newName !== r.source.fileName && (
                      <div className="rename">→ {r.newName}</div>
                    )}
                    <div className="sizes">
                      <span className="before">{formatBytes(r.source.size)}</span>
                      <span className="arrow-small">→</span>
                      <span className="after">{formatBytes(r.newSize ?? 0)}</span>
                      <span className="reduction">−{Math.round(reduction * 100)}%</span>
                    </div>
                  </div>
                  <label className="apply-toggle">
                    <input
                      type="checkbox"
                      checked={willApply}
                      onChange={() => toggleApply(r.source.path)}
                    />
                    <span>{willApply ? 'Replace' : 'Keep original'}</span>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {skipped.length > 0 && (
        <details className="report">
          <summary>{skipped.length} skipped — compression produced no size reduction</summary>
          <ul>
            {skipped.map((r) => (
              <li key={r.source.path}>
                <span className="path">{r.source.path}</span>
                <span className="size">
                  {formatBytes(r.source.size)} → {formatBytes(r.newSize ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {errored.length > 0 && (
        <details className="report" open>
          <summary>{errored.length} failed</summary>
          <ul>
            {errored.map((r) => (
              <li key={r.source.path}>
                <span className="path">{r.source.path}</span>
                <span className="err">{r.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {zoomIdx != null && (
        <CompareLightbox
          galleryId={galleryId}
          items={ok}
          index={zoomIdx}
          setIndex={setZoomIdx}
          applyChoices={applyChoices}
          toggleApply={toggleApply}
          outputFormat={outputFormat}
          onClose={() => setZoomIdx(null)}
        />
      )}

      <style jsx>{`
        .summary {
          display: flex; justify-content: space-between; align-items: center;
          gap: 16px;
          padding: 12px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          margin-bottom: 16px;
          font-family: var(--mono);
          font-size: 12px;
          color: var(--text);
          letter-spacing: 0.04em;
          flex-wrap: wrap;
        }
        .summary strong { color: var(--text); font-weight: 600; }
        .summary .muted { color: var(--text-muted); }
        .summary .bad { color: #d97a4a; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; }

        .cards {
          list-style: none; margin: 0; padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
          gap: 12px;
        }
        .card {
          padding: 12px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 10px;
          transition: opacity 0.15s, border-color 0.15s;
        }
        .card.off { opacity: 0.55; border-color: var(--border); }
        .card.on { border-color: rgba(232, 160, 74, 0.4); }
        .thumbs {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 8px;
          align-items: center;
          cursor: zoom-in;
          margin-bottom: 10px;
        }
        .thumbs img {
          width: 100%;
          aspect-ratio: 1 / 1;
          object-fit: cover;
          border-radius: 6px;
          background: var(--bg);
        }
        .thumbs .arrow {
          font-family: var(--mono);
          color: var(--text-muted);
          font-size: 14px;
        }

        .meta { padding: 0 4px; }
        .name {
          font-size: 13px; color: var(--text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rename {
          font-family: var(--mono);
          font-size: 10px;
          color: var(--accent);
          margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sizes {
          display: flex; align-items: baseline; gap: 6px;
          font-family: var(--mono);
          font-size: 11px;
          margin-top: 4px;
        }
        .sizes .before { color: var(--text-muted); text-decoration: line-through; }
        .sizes .arrow-small { color: var(--text-muted); }
        .sizes .after { color: var(--text); }
        .sizes .reduction { color: var(--accent); margin-left: auto; font-weight: 600; }

        .apply-toggle {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 0 0;
          margin-top: 8px;
          border-top: 1px solid var(--border);
          padding-top: 8px;
          cursor: pointer;
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text);
          letter-spacing: 0.05em;
        }
        .apply-toggle input { accent-color: var(--accent); }

        .report {
          margin-top: 16px;
          padding: 12px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 10px;
          font-family: var(--mono);
          font-size: 12px;
        }
        .report summary {
          cursor: pointer;
          color: var(--text);
          font-weight: 500;
        }
        .report ul { list-style: none; margin: 10px 0 0; padding: 0; }
        .report li {
          display: flex; justify-content: space-between; gap: 12px;
          padding: 4px 0;
          color: var(--text-muted);
          font-size: 11px;
        }
        .report .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .report .size, .report .err { flex-shrink: 0; }
        .report .err { color: #d97a4a; }
      `}</style>
    </>
  );
}

function CompareLightbox({
  galleryId,
  items,
  index,
  setIndex,
  applyChoices,
  toggleApply,
  outputFormat,
  onClose,
}: {
  galleryId: string;
  items: CompressedResult[];
  index: number;
  setIndex: (n: number) => void;
  applyChoices: Map<string, boolean>;
  toggleApply: (path: string) => void;
  outputFormat: 'webp' | 'jpeg';
  onClose: () => void;
}) {
  const item = items[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) setIndex(index + 1);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleApply(item.source.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, item, setIndex, onClose, toggleApply]);

  if (!item) return null;
  const willApply = applyChoices.get(item.source.path) ?? false;
  const reduction = 1 - (item.newSize ?? item.source.size) / item.source.size;

  return (
    <div className="overlay" onClick={onClose} role="dialog">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <span className="pos">{index + 1} / {items.length}</span>
          <span className="name">{item.source.path}</span>
          <button type="button" className="btn ghost small" onClick={onClose}>Close</button>
        </div>

        <div className="panes">
          <div className="pane">
            <div className="caption">Original · {formatBytes(item.source.size)}</div>
            <img
              src={`picg://gallery/${encodeURIComponent(galleryId)}/${item.source.path
                .split('/')
                .map(encodeURIComponent)
                .join('/')}?thumb=1024`}
              alt="before"
            />
          </div>
          <div className="pane">
            <div className="caption">
              Compressed · {formatBytes(item.newSize ?? 0)} ·{' '}
              <span className="reduction">−{Math.round(reduction * 100)}%</span>
              {extensionWillChange(item.source.path, outputFormat) && (
                <span className="ext"> · {item.newName}</span>
              )}
            </div>
            <img src={item.blobUrl} alt="after" />
          </div>
        </div>

        <div className="footer">
          <button
            type="button"
            className="btn ghost small"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            ← Prev
          </button>
          <label className="apply">
            <input
              type="checkbox"
              checked={willApply}
              onChange={() => toggleApply(item.source.path)}
            />
            <span>{willApply ? 'Replace this photo' : 'Keep original'}</span>
          </label>
          <button
            type="button"
            className="btn ghost small"
            disabled={index >= items.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            Next →
          </button>
        </div>
        <div className="hint">← / → to flip · Space to toggle · Esc to close</div>
      </div>

      <style jsx>{`
        .overlay {
          position: fixed; inset: 0;
          background: rgba(0, 0, 0, 0.85);
          z-index: 100;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .modal {
          background: var(--bg-card);
          border: 1px solid var(--border-strong);
          border-radius: 12px;
          max-width: 1280px;
          width: 100%;
          max-height: 100%;
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        .head {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
          font-family: var(--mono);
          font-size: 12px;
          color: var(--text);
        }
        .head .pos { color: var(--text-muted); flex-shrink: 0; }
        .head .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .panes {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 8px;
          flex: 1;
          overflow: hidden;
        }
        .pane {
          display: flex; flex-direction: column; gap: 6px;
          min-width: 0;
        }
        .caption {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.04em;
          padding: 0 4px;
        }
        .reduction { color: var(--accent); }
        .ext { color: var(--text); }
        .pane img {
          width: 100%;
          flex: 1;
          object-fit: contain;
          background: var(--bg);
          border-radius: 4px;
          min-height: 0;
        }
        .footer {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px;
          padding: 12px 16px;
          border-top: 1px solid var(--border);
        }
        .apply {
          display: flex; align-items: center; gap: 8px;
          font-family: var(--mono);
          font-size: 12px;
          color: var(--text);
          cursor: pointer;
        }
        .apply input { accent-color: var(--accent); }
        .hint {
          padding: 0 16px 12px;
          font-family: var(--mono);
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          letter-spacing: 0.05em;
        }
      `}</style>
    </div>
  );
}

function ApplyingView({ progress }: { progress: { done: number; total: number } | null }) {
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  return (
    <div className="wrap">
      <div className="head">
        <span>Applying {progress?.done ?? 0} / {progress?.total ?? 0}</span>
      </div>
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      <style jsx>{`
        .wrap { padding: 32px; background: var(--bg-card);
                border: 1px solid var(--border); border-radius: 12px; }
        .head { font-family: var(--mono); font-size: 13px; color: var(--text);
                margin-bottom: 14px; }
        .bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
        .bar span { display: block; height: 100%; background: var(--accent);
                    transition: width 0.2s ease; }
      `}</style>
    </div>
  );
}

function DoneView({
  report,
  galleryHref,
}: {
  report: { replaced: number; deletedOriginals: number; coverRewrites: number; failed: Array<{ path: string; error: string }> };
  galleryHref: string;
}) {
  return (
    <div className="wrap">
      <h2>Done</h2>
      <ul className="lines">
        <li><strong>{report.replaced}</strong> photos replaced</li>
        {report.deletedOriginals > 0 && (
          <li><strong>{report.deletedOriginals}</strong> originals deleted (extension changed)</li>
        )}
        {report.coverRewrites > 0 && (
          <li><strong>{report.coverRewrites}</strong> cover ref{report.coverRewrites === 1 ? '' : 's'} rewritten in README.yml</li>
        )}
        {report.failed.length > 0 && (
          <li className="bad"><strong>{report.failed.length}</strong> failure{report.failed.length === 1 ? '' : 's'}</li>
        )}
      </ul>
      {report.failed.length > 0 && (
        <details open>
          <summary>Failures</summary>
          <ul className="errs">
            {report.failed.map((f, i) => (
              <li key={i}>
                <span className="path">{f.path}</span>
                <span className="err">{f.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="rollback">
        To roll back: <code>git reset --hard HEAD~{report.replaced + (report.deletedOriginals > 0 ? report.deletedOriginals : 0) + (report.coverRewrites > 0 ? 1 : 0)}</code>{' '}in the gallery clone.
      </p>
      <Link href={galleryHref as any} className="btn primary">
        Back to gallery
      </Link>
      <style jsx>{`
        .wrap {
          padding: 32px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        h2 { font-family: var(--serif); font-size: 28px; font-weight: 400;
             margin: 0 0 16px; color: var(--text); }
        .lines { list-style: none; margin: 0 0 16px; padding: 0;
                 font-family: var(--mono); font-size: 13px; color: var(--text); }
        .lines li { padding: 4px 0; }
        .lines .bad { color: #d97a4a; }
        details { margin-bottom: 16px; }
        details summary { cursor: pointer; font-family: var(--mono); font-size: 12px;
                          color: var(--text-muted); }
        .errs { list-style: none; margin: 8px 0 0; padding: 0; }
        .errs li { display: flex; gap: 12px; padding: 4px 0;
                   font-family: var(--mono); font-size: 11px; color: var(--text-muted); }
        .errs .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .errs .err { color: #d97a4a; }
        .rollback {
          margin: 16px 0;
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-muted);
        }
        .rollback code {
          background: var(--bg);
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--text);
        }
      `}</style>
    </div>
  );
}
