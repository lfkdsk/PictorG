'use client';

// Bottom-right toast that appears after a single-commit mutation, with an
// Undo button that runs `git reset --hard HEAD~1` via IPC. Cross-page,
// fire-and-forget — pages call fireUndoToast() after a successful commit
// and don't have to thread state through.
//
// Two pieces:
//   - <UndoToastHost />: the actual UI. Render once per page that wants
//     toasts (e.g. inside the page component, near <DesktopTheme />).
//   - fireUndoToast({ galleryId, message }): module-level fn, callable
//     from event handlers anywhere.
//
// Skipped on purpose:
//   - Multi-commit ops (album delete, anything that lands ≥2 commits)
//     — one Undo would only revert the last one, leaving a half-state.
//     The album-delete path already gates on a confirm input, so the
//     toast wouldn't add safety there.
//   - Pushes — that's the Topbar's job (badge + arrow).
//   - Clone/remove — managed at the library level, not per-gallery.
//
// After a successful undo we hard-reload the page. The renderer's
// in-memory state (album list, photo grid, EXIF caches, etc.) all came
// from the now-rolled-back commit, and reloading is cheaper to maintain
// than per-page invalidation hooks.

import { useEffect, useRef, useState } from 'react';

import { getPicgBridge } from '@/core/storage';

type ToastState = {
  galleryId: string;
  // Human-readable label for what just happened. Shown above the Undo
  // button — keep it short ("Reordered albums", "Saved annual summary").
  message: string;
  // Strictly increasing id so re-firing while one is visible bumps the
  // host into a fresh toast (resets the auto-dismiss timer).
  id: number;
};

type ToastResultState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'reverted'; subject: string }
  | { kind: 'refused'; reason: 'already-pushed' | 'no-prior-commit' | 'dirty' }
  | { kind: 'error'; message: string };

const listeners = new Set<(s: ToastState) => void>();
let nextId = 1;

// sessionStorage key carries a toast across a route change. The mutation
// pages (new-album, add-photos) commit and immediately router.push back
// to the album/gallery page — by the time the destination's
// UndoToastHost mounts, the source page's listener is gone, so a pure
// in-memory pub/sub would drop the event. Stashing here lets the
// destination pick it up on mount.
const PENDING_KEY = 'picg:undo-toast-pending';

export function fireUndoToast(opts: {
  galleryId: string;
  message: string;
}): void {
  const evt: ToastState = {
    galleryId: opts.galleryId,
    message: opts.message,
    id: nextId++,
  };
  // Always stash — survives cross-route navigation. Same-page hosts also
  // get the live signal through `listeners` and clear the stash to avoid
  // a duplicate display on the next mount.
  try {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify({ ...evt, ts: Date.now() })
      );
    }
  } catch {
    /* sessionStorage may be disabled — fall through to live listeners */
  }
  listeners.forEach((l) => l(evt));
}

function consumePending(): ToastState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const obj = JSON.parse(raw) as ToastState & { ts?: number };
    // Drop anything older than 30s — the user has moved on by then,
    // showing a stale "Undo" would be confusing.
    if (obj.ts && Date.now() - obj.ts > 30_000) return null;
    return { galleryId: obj.galleryId, message: obj.message, id: obj.id };
  } catch {
    return null;
  }
}

export function UndoToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [result, setResult] = useState<ToastResultState>({ kind: 'idle' });
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Replay any toast that was queued just before a route change.
    const pending = consumePending();
    if (pending) {
      setToast(pending);
      setResult({ kind: 'idle' });
    }

    const handler = (s: ToastState) => {
      setToast(s);
      setResult({ kind: 'idle' });
      // We just consumed it live — drop the session-storage copy so a
      // sibling mount doesn't re-display the same toast.
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(PENDING_KEY);
        }
      } catch {
        /* ignore */
      }
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  // Auto-dismiss after 6s — long enough to read + click, short enough to
  // not pile up if the user is doing a lot of edits in a row. Resets each
  // time a new toast comes in (different id).
  useEffect(() => {
    if (!toast) return;
    if (result.kind === 'busy' || result.kind === 'error') return;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      setToast(null);
      setResult({ kind: 'idle' });
    }, 6000);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [toast?.id, result.kind]);

  async function onUndo() {
    if (!toast) return;
    const bridge = getPicgBridge();
    if (!bridge) return;
    setResult({ kind: 'busy' });
    try {
      const r = await bridge.gallery.undoLastCommit(toast.galleryId);
      if (r.ok) {
        // Hard nav: page state was built from the rolled-back commit;
        // any cached album/photo lists are stale.
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      } else {
        setResult({ kind: 'refused', reason: r.refused });
      }
    } catch (err) {
      setResult({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function dismiss() {
    setToast(null);
    setResult({ kind: 'idle' });
  }

  if (!toast) return null;

  const refusalLabel: Record<
    Extract<ToastResultState, { kind: 'refused' }>['reason'],
    string
  > = {
    'already-pushed': 'Already pushed — undo would rewrite remote history.',
    'no-prior-commit': 'No prior commit to roll back to.',
    dirty: 'Working tree has uncommitted changes.',
  };

  return (
    <div className="picg-undo-toast" role="status" aria-live="polite">
      <div className="picg-undo-toast-row">
        <span className="picg-undo-toast-msg">{toast.message}</span>
        {result.kind === 'idle' && (
          <button
            type="button"
            className="picg-undo-toast-action"
            onClick={onUndo}
          >
            Undo
          </button>
        )}
        {result.kind === 'busy' && (
          <span className="picg-undo-toast-busy">Undoing…</span>
        )}
        <button
          type="button"
          className="picg-undo-toast-dismiss"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {result.kind === 'refused' && (
        <div className="picg-undo-toast-note">
          Can&apos;t undo: {refusalLabel[result.reason]}
        </div>
      )}
      {result.kind === 'error' && (
        <div className="picg-undo-toast-note picg-undo-toast-error">
          {result.message}
        </div>
      )}
      <style jsx>{`
        .picg-undo-toast {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 200;
          background: var(--bg-card, #1a1a1a);
          color: var(--text);
          border: 1px solid var(--border-strong, #2a2a2a);
          border-radius: 10px;
          padding: 10px 12px 10px 16px;
          min-width: 280px;
          max-width: 420px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
          font-size: 13px;
          animation: picg-undo-toast-in 0.18s ease-out;
        }
        .picg-undo-toast-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .picg-undo-toast-msg {
          flex: 1;
          color: var(--text);
          font-family: var(--sans, inherit);
          line-height: 1.4;
        }
        .picg-undo-toast-action {
          background: transparent;
          color: var(--accent);
          border: 1px solid var(--accent);
          border-radius: 6px;
          padding: 4px 12px;
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .picg-undo-toast-action:hover {
          background: var(--accent);
          color: var(--accent-text);
        }
        .picg-undo-toast-busy {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .picg-undo-toast-dismiss {
          background: transparent;
          border: none;
          color: var(--text-faint);
          font-size: 14px;
          cursor: pointer;
          padding: 2px 4px;
          line-height: 1;
        }
        .picg-undo-toast-dismiss:hover {
          color: var(--text);
        }
        .picg-undo-toast-note {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--border);
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.4;
        }
        .picg-undo-toast-error {
          color: #f0bfb6;
        }
        @keyframes picg-undo-toast-in {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
