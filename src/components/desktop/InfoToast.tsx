'use client';

// Lightweight info-level toast — same bottom-right placement and
// styling as UndoToast, but without the undo action. Used for
// non-actionable feedback that would otherwise have called alert(),
// e.g. "you are on the latest version", "update found, downloading".
//
// Two pieces:
//   - <InfoToastHost /> — renders the live toast. Mount once
//     somewhere always present; the Topbar in DesktopChrome is the
//     natural spot since every desktop page already includes it.
//   - fireInfoToast({ message, kind? }) — module-level fn callable
//     from anywhere. `kind` switches the accent color: 'info' (cream)
//     for plain notices, 'error' (warm orange) for failures.
//
// No cross-route persistence (UndoToast needs that because mutations
// trigger a router.push immediately after firing). Info messages
// fire in-page and never need to outlive a navigation.

import { useEffect, useRef, useState } from 'react';

type InfoKind = 'info' | 'error';

type ToastState = {
  message: string;
  kind: InfoKind;
  // Strictly increasing id so re-firing while one is visible bumps the
  // host into a fresh toast (resets the auto-dismiss timer).
  id: number;
};

const listeners = new Set<(s: ToastState) => void>();
let nextId = 1;

export function fireInfoToast(opts: {
  message: string;
  kind?: InfoKind;
}): void {
  const evt: ToastState = {
    message: opts.message,
    kind: opts.kind ?? 'info',
    id: nextId++,
  };
  listeners.forEach((l) => l(evt));
}

export function InfoToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (s: ToastState) => setToast(s);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  // Auto-dismiss. Errors stick longer than plain info so the user has
  // time to read the message before it slides off.
  useEffect(() => {
    if (!toast) return;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(
      () => setToast(null),
      toast.kind === 'error' ? 8000 : 4500
    );
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [toast?.id]);

  if (!toast) return null;

  return (
    <div className={`picg-info-toast picg-info-toast-${toast.kind}`} role="status" aria-live="polite">
      <span className="picg-info-toast-msg">{toast.message}</span>
      <button
        type="button"
        className="picg-info-toast-dismiss"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
      >
        ✕
      </button>
      <style jsx>{`
        .picg-info-toast {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 200;
          display: flex; align-items: center; gap: 12px;
          background: var(--bg-card, #1a1a1a);
          color: var(--text);
          border: 1px solid var(--border-strong, #2a2a2a);
          border-radius: 10px;
          padding: 10px 12px 10px 16px;
          min-width: 280px;
          max-width: 480px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
          font-size: 13px;
          line-height: 1.4;
          animation: picg-info-toast-in 0.18s ease-out;
        }
        .picg-info-toast-error {
          border-color: rgba(216, 90, 70, 0.45);
          background: rgba(216, 90, 70, 0.08);
        }
        .picg-info-toast-msg {
          flex: 1;
          color: var(--text);
          font-family: var(--sans, inherit);
        }
        .picg-info-toast-error .picg-info-toast-msg {
          color: #f0bfb6;
        }
        .picg-info-toast-dismiss {
          background: transparent;
          border: none;
          color: var(--text-faint);
          font-size: 14px;
          cursor: pointer;
          padding: 2px 4px;
          line-height: 1;
        }
        .picg-info-toast-dismiss:hover { color: var(--text); }
        @keyframes picg-info-toast-in {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
