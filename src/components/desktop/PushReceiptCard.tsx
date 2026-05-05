'use client';

// Post-push transparency card. Renders inline at the top of the
// gallery page after a successful push, summarising what just got
// sent: which identity authored the (squash) commit, how many ops
// got collapsed, and a link to the commit on github.com.
//
// Why a card and not a corner toast: the receipt has multi-line
// content with an expandable subject list, and a corner toast at
// the typical 4-5 second timeout doesn't give the user time to
// read it. We keep it inline + dismissable + auto-fading on a
// longer timer.
//
// The component is intentionally passive — it never triggers
// further IPC. The renderer page owns the state (so it can
// re-show on a fresh push), passes the receipt in, and clears
// it via onDismiss.

import { useEffect } from 'react';

import type { PushReceipt } from '@/core/storage';

const AUTO_DISMISS_MS = 18_000;

export function PushReceiptCard({
  receipt,
  onDismiss,
}: {
  receipt: PushReceipt;
  onDismiss: () => void;
}) {
  // Auto-dismiss so receipts don't pile up over a session of edits.
  // 18s is calibrated to be long enough to read + click "View on
  // GitHub" without rushing, short enough to not linger across a
  // navigation.
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [receipt, onDismiss]);

  // Build the github.com commit URL. `remoteUrl` is `https://github.com/<owner>/<repo>(.git)?`
  // — strip the optional `.git` so the rendered URL is the canonical
  // human-facing form.
  const commitUrl = `${receipt.target.remoteUrl.replace(/\.git$/, '')}/commit/${receipt.pushedSha}`;
  const shortSha = receipt.pushedSha.slice(0, 7);
  const fallbackIdentity = receipt.identity.source === 'fallback';
  const mixedAuthors = receipt.authors.length > 1;

  return (
    <div className="picg-push-receipt" role="status" aria-live="polite">
      <div className="picg-push-receipt-head">
        <span className="picg-push-receipt-icon" aria-hidden>✓</span>
        <span className="picg-push-receipt-title">
          {receipt.squash
            ? `Pushed ${receipt.squash.collapsed.length} ops as 1 commit`
            : 'Pushed'}{' '}
          to{' '}
          <code>{receipt.target.fullName}</code>
          {' / '}
          <code>{receipt.target.branch}</code>
        </span>
        <a
          className="picg-push-receipt-link"
          href={commitUrl}
          target="_blank"
          rel="noreferrer"
          title={`Open ${shortSha} on GitHub`}
        >
          {shortSha} ↗
        </a>
        <button
          type="button"
          className="picg-push-receipt-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>

      <div className="picg-push-receipt-body">
        <div className="picg-push-receipt-row">
          <span className="picg-push-receipt-label">Authored as</span>
          <span className="picg-push-receipt-value">
            {receipt.identity.name}{' '}
            <code>&lt;{receipt.identity.email}&gt;</code>
            {fallbackIdentity && (
              <span className="picg-push-receipt-warn">
                {' '}— couldn't reach GitHub, using fallback
              </span>
            )}
          </span>
        </div>

        {mixedAuthors && (
          <div className="picg-push-receipt-row picg-push-receipt-warn-row">
            This push collapsed commits from {receipt.authors.length} different identities:
            <ul className="picg-push-receipt-author-list">
              {receipt.authors.map((a) => (
                <li key={a.email}>
                  {a.name} <code>&lt;{a.email}&gt;</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {receipt.squash && (
          <details className="picg-push-receipt-details">
            <summary>{receipt.squash.collapsed.length} ops collapsed</summary>
            <ul className="picg-push-receipt-op-list">
              {receipt.squash.collapsed.map((subject, i) => (
                <li key={i}>{subject}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <style jsx>{`
        .picg-push-receipt {
          margin: 0 0 16px;
          padding: 12px 14px;
          border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
          border-left: 3px solid #6fae6a;
          border-radius: 8px;
          background: rgba(111, 174, 106, 0.06);
          font-family: var(--sans, inherit);
          font-size: 13px;
          line-height: 1.5;
          color: var(--text);
          animation: picg-push-receipt-in 0.18s ease-out;
        }
        .picg-push-receipt-head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .picg-push-receipt-icon {
          color: #6fae6a;
          font-weight: bold;
          font-size: 14px;
        }
        .picg-push-receipt-title {
          flex: 1;
          min-width: 0;
        }
        .picg-push-receipt-title code {
          font-family: var(--mono, monospace);
          font-size: 12px;
          background: rgba(255, 255, 255, 0.06);
          padding: 1px 5px;
          border-radius: 3px;
        }
        .picg-push-receipt-link {
          font-family: var(--mono, monospace);
          font-size: 12px;
          color: var(--text-muted, rgba(255, 255, 255, 0.55));
          text-decoration: none;
          padding: 2px 6px;
          border-radius: 3px;
          transition: color 0.12s, background 0.12s;
        }
        .picg-push-receipt-link:hover {
          color: var(--text);
          background: rgba(255, 255, 255, 0.06);
        }
        .picg-push-receipt-dismiss {
          background: transparent;
          border: none;
          color: var(--text-faint, rgba(255, 255, 255, 0.4));
          cursor: pointer;
          padding: 2px 6px;
          font-size: 13px;
          line-height: 1;
        }
        .picg-push-receipt-dismiss:hover {
          color: var(--text);
        }
        .picg-push-receipt-body {
          margin-top: 8px;
          padding-left: 22px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: var(--text-muted, rgba(255, 255, 255, 0.7));
        }
        .picg-push-receipt-row {
          display: flex;
          gap: 8px;
          align-items: baseline;
        }
        .picg-push-receipt-label {
          color: var(--text-faint, rgba(255, 255, 255, 0.4));
          min-width: 92px;
          font-family: var(--mono, monospace);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .picg-push-receipt-value code {
          font-family: var(--mono, monospace);
          font-size: 12px;
          color: var(--text);
        }
        .picg-push-receipt-warn {
          color: #d8a55a;
        }
        .picg-push-receipt-warn-row {
          flex-direction: column;
          align-items: flex-start;
          color: #d8a55a;
        }
        .picg-push-receipt-author-list {
          margin: 4px 0 0;
          padding-left: 16px;
          color: var(--text);
        }
        .picg-push-receipt-author-list code {
          font-family: var(--mono, monospace);
          font-size: 11px;
          color: var(--text-muted, rgba(255, 255, 255, 0.65));
        }
        .picg-push-receipt-details summary {
          cursor: pointer;
          color: var(--text-muted, rgba(255, 255, 255, 0.6));
          font-family: var(--mono, monospace);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          user-select: none;
        }
        .picg-push-receipt-details summary:hover {
          color: var(--text);
        }
        .picg-push-receipt-details[open] summary {
          color: var(--text);
          margin-bottom: 4px;
        }
        .picg-push-receipt-op-list {
          margin: 0;
          padding-left: 16px;
          color: var(--text);
          font-family: var(--mono, monospace);
          font-size: 12px;
        }
        .picg-push-receipt-op-list li {
          margin: 2px 0;
        }
        @keyframes picg-push-receipt-in {
          from { transform: translateY(-4px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
