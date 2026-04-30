'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import { fetchGitHubFile, getGitHubToken } from '@/lib/github';
import { openGalleryDb } from '@/lib/sqlite';
import {
  AnnualSummary,
  CandidatePhoto,
  GalleryUrlConfig,
  MonthKey,
  MonthlyCandidates,
  fetchSummary,
  listMonthlyCandidates,
  parseGalleryConfig,
  saveSummary,
  thumbnailUrlFor,
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

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      cfg: GalleryUrlConfig;
      candidates: MonthlyCandidates;
      months: MonthKey[];
    };

const draftKey = (owner: string, repo: string, year: string) =>
  `annualSummaryDraft:${owner}/${repo}:${year}`;

export default function AnnualSummaryPicker() {
  const params = useParams();
  const router = useRouter();
  const owner = params.owner as string;
  const repo = params.repo as string;
  const year = params.year as string;

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [stepIdx, setStepIdx] = useState(0);
  const [selections, setSelections] = useState<AnnualSummary>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = getGitHubToken();
        if (!token) throw new Error('未登录');
        const configText = await fetchGitHubFile(token, owner, repo, 'CONFIG.yml');
        const cfg = parseGalleryConfig(configText);
        const db = await openGalleryDb(cfg.siteUrl);
        const candidates = listMonthlyCandidates(db, year);
        const months = ALL_MONTHS.filter((m) => (candidates[m]?.length ?? 0) > 0);
        if (cancelled) return;

        const existing = await fetchSummary(token, owner, repo, year);
        const draftRaw = sessionStorage.getItem(draftKey(owner, repo, year));
        let initial: AnnualSummary = {};
        if (draftRaw) {
          try {
            initial = JSON.parse(draftRaw);
          } catch {
            initial = {};
          }
        } else if (existing) {
          initial = existing;
        }
        if (cancelled) return;
        setSelections(initial);
        setState({ kind: 'ready', cfg, candidates, months });
        setStepIdx(0);
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : '加载失败',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, year]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    sessionStorage.setItem(draftKey(owner, repo, year), JSON.stringify(selections));
  }, [selections, state.kind, owner, repo, year]);

  const months = state.kind === 'ready' ? state.months : [];
  const currentMonth = months[stepIdx];
  const candidatesForMonth: CandidatePhoto[] =
    state.kind === 'ready' && currentMonth ? state.candidates[currentMonth] ?? [] : [];

  const completedCount = useMemo(
    () => months.filter((m) => selections[m]).length,
    [months, selections],
  );

  const onPick = (path: string) => {
    if (!currentMonth) return;
    setSelections((s) => ({ ...s, [currentMonth]: path }));
  };

  const onSkip = () => {
    if (!currentMonth) return;
    setSelections((s) => {
      const next = { ...s };
      delete next[currentMonth];
      return next;
    });
    if (stepIdx < months.length - 1) setStepIdx((i) => i + 1);
  };

  const onPrev = () => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };

  const onNext = () => {
    if (stepIdx < months.length - 1) setStepIdx((i) => i + 1);
  };

  const onSubmit = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const token = getGitHubToken();
      if (!token) throw new Error('未登录');
      await saveSummary(token, owner, repo, year, selections);
      sessionStorage.removeItem(draftKey(owner, repo, year));
      router.push(`/gallery/${owner}/${repo}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const isLastStep = stepIdx === months.length - 1;

  return (
    <AuthGuard>
      <div className="container">
        <header className="header">
          <Link href={`/gallery/${owner}/${repo}`} className="back-link">
            ← 返回 {owner}/{repo}
          </Link>
          <h1 className="title">{year} 年度精选</h1>
          <p className="subtitle">
            {state.kind === 'ready'
              ? `共 ${months.length} 个有图月份，已选 ${completedCount} / ${months.length}`
              : '加载中…'}
          </p>
        </header>

        {state.kind === 'loading' && <div className="info">读取 sqlite.db 中…</div>}
        {state.kind === 'error' && <div className="error">错误：{state.message}</div>}

        {state.kind === 'ready' && months.length === 0 && (
          <div className="info">该年度数据库里没有照片。</div>
        )}

        {state.kind === 'ready' && currentMonth && (
          <>
            <nav className="month-tabs">
              {months.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className={`tab ${i === stepIdx ? 'active' : ''} ${selections[m] ? 'done' : ''}`}
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

            <div className="grid">
              {candidatesForMonth.map((p) => {
                const picked = selections[currentMonth] === p.path;
                return (
                  <button
                    key={p.path}
                    type="button"
                    className={`thumb ${picked ? 'picked' : ''}`}
                    onClick={() => onPick(p.path)}
                  >
                    <img
                      src={thumbnailUrlFor(state.cfg, p.path)}
                      alt={p.path}
                      loading="lazy"
                      crossOrigin="anonymous"
                    />
                    <div className="meta">
                      <span className="date">{p.date}</span>
                      <span className="path" title={p.path}>{p.path}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                onClick={onPrev}
                disabled={stepIdx === 0 || saving}
              >
                上一月
              </button>
              <button type="button" className="btn ghost" onClick={onSkip} disabled={saving}>
                清除并跳过
              </button>
              {!isLastStep ? (
                <button type="button" className="btn primary" onClick={onNext} disabled={saving}>
                  下一月
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={onSubmit}
                  disabled={saving || completedCount === 0}
                >
                  {saving ? '保存中…' : `保存到 .analysis/annual-summary/${year}.json`}
                </button>
              )}
            </div>
            {saveError && <div className="error">保存失败：{saveError}</div>}
          </>
        )}

        <style jsx>{`
          .container { width: min(1200px, 94vw); margin: 0 auto; padding: 20px; }
          .header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
          .back-link { color: var(--primary); text-decoration: none; font-size: 14px; }
          .title { font-size: 26px; font-weight: 700; margin: 8px 0 4px; color: var(--text); }
          .subtitle { color: var(--text-secondary); margin: 0; font-size: 14px; }
          .info { padding: 24px; text-align: center; color: var(--text-secondary); }
          .error { padding: 12px; color: #ef4444; }
          .month-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 16px;
            padding: 8px;
            border: 1px solid var(--border);
            border-radius: 12px;
            background: var(--surface);
          }
          .tab {
            position: relative;
            background: transparent;
            border: 1px solid transparent;
            color: var(--text-secondary);
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.15s ease;
          }
          .tab:hover { color: var(--text); }
          .tab.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
          }
          .tab.done { color: var(--text); }
          .tab .dot {
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #10b981;
            margin-left: 6px;
            vertical-align: middle;
          }
          .step-info { margin-bottom: 12px; }
          .step-info h2 { font-size: 18px; margin: 0 0 4px; color: var(--text); }
          .picked { font-size: 13px; color: var(--text-secondary); margin: 0; }
          .picked code { background: var(--surface); padding: 2px 6px; border-radius: 4px; }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 20px;
          }
          .thumb {
            background: var(--surface);
            border: 2px solid var(--border);
            border-radius: 12px;
            padding: 0;
            overflow: hidden;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s ease;
          }
          .thumb:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--primary), transparent 50%); }
          .thumb.picked { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary), transparent 80%); }
          .thumb img { display: block; width: 100%; aspect-ratio: 4/3; object-fit: cover; background: var(--border); }
          .meta { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
          .date { color: var(--text-secondary); }
          .path { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            padding-top: 12px;
            border-top: 1px solid var(--border);
            position: sticky;
            bottom: 0;
            background: var(--background);
            padding-bottom: 12px;
          }
          .btn {
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text);
            transition: all 0.15s ease;
          }
          .btn.primary { background: var(--primary); color: white; border-color: var(--primary); }
          .btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--primary), black 10%); }
          .btn.ghost:hover:not(:disabled) { color: var(--text); }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        `}</style>
      </div>
    </AuthGuard>
  );
}
