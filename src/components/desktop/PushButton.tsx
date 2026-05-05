'use client';

// Topbar push button + hover tooltip listing the commits that the
// next push will ship. The tooltip is the cheap, "show me what I'm
// about to send" preview the user asked for — every storage adapter
// call site already supplies a human-readable commit subject (see
// "Add 5 photos to landscape", "Reorder albums", etc.), so we just
// pull the subjects between origin/<branch>..HEAD and render them.
//
// Why a component instead of inlining: two pages render this button
// (galleries/[id] and galleries/[id]/[album]); the popover, fetch-on-
// hover, and ahead-change cache invalidation are non-trivial enough
// that keeping it in one place is worth a tiny indirection.

import { useEffect, useRef, useState } from 'react';

import type { UnpushedCommit } from '@/core/storage/electron/PreloadBridgeAdapter';
import { getPicgBridge } from '@/core/storage/electron';

type Props = {
  galleryId: string;
  ahead: number;
  pushing: boolean;
  disabled: boolean;
  onClick: () => void;
};

// Cap on how many subjects the tooltip lists before collapsing the
// rest into "… and N more". Picked empirically: 8 lines fits a
// reasonable-height tooltip without scrolling on a 13" laptop.
const MAX_VISIBLE_SUBJECTS = 8;

export function PushButton({
  galleryId,
  ahead,
  pushing,
  disabled,
  onClick,
}: Props) {
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<UnpushedCommit[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Cache key. When `ahead` changes (push happened, undo, new commit),
  // we invalidate so the next hover refetches. Keyed on `ahead`
  // because the user-visible state we're showing IS the count and the
  // list of those N commits — if N changes the cached list is wrong.
  const cachedFor = useRef<number | null>(null);

  // Lazy fetch on first hover (or when `ahead` invalidates a cached list).
  useEffect(() => {
    if (!open) return;
    if (ahead === 0) return;
    if (cachedFor.current === ahead && commits) return;

    const bridge = getPicgBridge();
    if (!bridge) return;

    let cancelled = false;
    setLoading(true);
    bridge.gallery
      .unpushedCommits(galleryId)
      .then((result) => {
        if (cancelled) return;
        setCommits(result);
        cachedFor.current = ahead;
      })
      .catch(() => {
        // Best-effort: tooltip falls back to count-only if the log
        // query fails. No user-facing error toast — this view is
        // informational, not on the action path.
        if (!cancelled) setCommits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, ahead, galleryId, commits]);

  // Invalidate cache when ahead changes (push/undo/new commit). The
  // useEffect above won't re-fire on its own because `open` is what
  // gates the fetch; explicit invalidation here ensures next hover
  // gets fresh data.
  useEffect(() => {
    if (cachedFor.current !== null && cachedFor.current !== ahead) {
      cachedFor.current = null;
      setCommits(null);
    }
  }, [ahead]);

  const showTooltip = open && ahead > 0;
  const visibleCommits = commits?.slice(-MAX_VISIBLE_SUBJECTS) ?? [];
  const hiddenCount = (commits?.length ?? 0) - visibleCommits.length;

  return (
    <span
      className="picg-push-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        className="picg-icon-btn"
        aria-label={
          ahead > 0
            ? `Push ${ahead} commit${ahead === 1 ? '' : 's'} to remote`
            : 'Push to remote'
        }
        // No native `title=` — we render our own tooltip below.
        // Keeping a native title would result in two overlapping
        // tooltips after the OS' hover delay.
        onClick={onClick}
        disabled={disabled}
      >
        <span className={pushing ? 'picg-spin' : ''}>↑</span>
        {ahead > 0 && <span className="picg-badge-count">{ahead}</span>}
      </button>

      {showTooltip && (
        <div className="picg-push-tooltip" role="tooltip">
          <div className="picg-push-tooltip-head">
            Will push {ahead} commit{ahead === 1 ? '' : 's'}
          </div>
          {loading && commits === null ? (
            <div className="picg-push-tooltip-loading">Loading…</div>
          ) : visibleCommits.length === 0 ? (
            // Either log query failed (commits === []) or there's no
            // upstream yet. Either way: silent fallback to count-only.
            <div className="picg-push-tooltip-loading">
              (subject list unavailable)
            </div>
          ) : (
            <ul className="picg-push-tooltip-list">
              {hiddenCount > 0 && (
                <li className="picg-push-tooltip-more">
                  … and {hiddenCount} earlier commit{hiddenCount === 1 ? '' : 's'}
                </li>
              )}
              {visibleCommits.map((c) => (
                <li key={c.sha} title={c.subject}>
                  {c.subject}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <style jsx>{`
        .picg-push-anchor {
          position: relative;
          display: inline-flex;
        }
        .picg-push-tooltip {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 50;
          min-width: 240px;
          max-width: 360px;
          padding: 8px 10px;
          background: rgba(28, 28, 30, 0.96);
          color: rgba(255, 255, 255, 0.92);
          border-radius: 6px;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
          font-size: 12px;
          line-height: 1.45;
          animation: picg-push-tooltip-in 0.12s ease-out;
          pointer-events: none;
        }
        .picg-push-tooltip-head {
          font-weight: 600;
          margin-bottom: 6px;
          color: rgba(255, 255, 255, 1);
        }
        .picg-push-tooltip-loading {
          color: rgba(255, 255, 255, 0.55);
          font-style: italic;
        }
        .picg-push-tooltip-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .picg-push-tooltip-list li {
          padding: 2px 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .picg-push-tooltip-list li::before {
          content: '·';
          margin-right: 6px;
          color: rgba(255, 255, 255, 0.45);
        }
        .picg-push-tooltip-more {
          color: rgba(255, 255, 255, 0.55);
          font-style: italic;
        }
        @keyframes picg-push-tooltip-in {
          from {
            opacity: 0;
            transform: translateY(-2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </span>
  );
}
