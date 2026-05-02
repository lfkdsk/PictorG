'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { getPicgBridge } from '@/core/storage';
import { storeAuthData, type GitHubUser } from '@/lib/auth';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';

const GITHUB_CLIENT_ID =
  process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || 'Ov23liCg29llKxJ7b0jv';
// The Worker registers a `picg-desktop` project key whose origin is
// `picg://oauth`; the auth callback URL therefore lives under that key.
const CALLBACK_URL = 'https://auth.lfkdsk.org/picg-desktop/callback';
const OAUTH_SCOPE = 'repo';
const STATE_KEY = 'picg_desktop_oauth_state';

type Phase =
  | { kind: 'idle' }
  | { kind: 'awaiting' }
  | { kind: 'error'; message: string };

export default function DesktopLoginPage() {
  const [bridge, setBridge] = useState(() => getPicgBridge());
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  useEffect(() => {
    setBridge(getPicgBridge());
  }, []);

  // Subscribe to picg://oauth callbacks dispatched by main. We mount the
  // listener even before the user clicks Sign in, in case main captured
  // a callback URL while the renderer was still booting.
  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.auth.onOAuthCallback(async (payload) => {
      if (!payload.ok) {
        setPhase({ kind: 'error', message: payload.error });
        return;
      }

      // CSRF check: the state we wrote into sessionStorage when the user
      // clicked Sign in must match what came back via picg://.
      const expected = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY);
      if (expected && payload.state !== expected) {
        setPhase({ kind: 'error', message: 'State mismatch — possible CSRF, please retry' });
        return;
      }

      try {
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `token ${payload.token}`,
            Accept: 'application/vnd.github+json',
          },
        });
        if (!userRes.ok) {
          setPhase({
            kind: 'error',
            message: `Token validation failed: ${userRes.status}`,
          });
          return;
        }
        const user = (await userRes.json()) as GitHubUser;
        storeAuthData(payload.token, user);
        // Hard nav, same reason as the rest of the desktop flows: avoids
        // Next dev webpack runtime drift on cross-route SPA push.
        window.location.assign('/desktop/galleries');
      } catch (err) {
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return unsub;
  }, [bridge]);

  function startSignIn() {
    if (!bridge) return;
    const state = `desktop:${crypto.randomUUID()}`;
    sessionStorage.setItem(STATE_KEY, state);
    setPhase({ kind: 'awaiting' });

    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      scope: OAUTH_SCOPE,
      state,
    });
    bridge.auth
      .openExternal(`https://github.com/login/oauth/authorize?${params.toString()}`)
      .catch((err) => {
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }

  if (!bridge) {
    return (
      <div className="page">
        <main className="empty">
          <h1>Desktop only</h1>
          <p>This sign-in flow runs in the desktop app.</p>
        </main>
        <DesktopTheme />
        <style jsx>{`
          .empty { padding: 96px 32px; max-width: 600px; margin: 0 auto; }
          .empty h1 { font-family: var(--serif); font-size: 56px; margin: 0 0 12px; font-weight: 400; }
          .empty p { color: var(--text-muted); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="page">
      <Topbar />

      <main
        style={{
          width: '100%',
          maxWidth: 600,
          margin: '0 auto',
          padding: '32px 40px 64px',
          boxSizing: 'border-box',
        }}
      >
        <section className="hero">
          <h1>Sign in</h1>
          <p className="meta">Pictor uses GitHub for storage and identity.</p>
        </section>

        <section className="card">
          <button
            type="button"
            className="btn primary"
            onClick={startSignIn}
            disabled={phase.kind === 'awaiting'}
          >
            {phase.kind === 'awaiting'
              ? 'Waiting for browser…'
              : 'Sign in with GitHub'}
          </button>
          <p className="hint">
            Opens GitHub in your default browser. After you authorize, the
            page will hand control back to PicG automatically.
          </p>

          {phase.kind === 'awaiting' && (
            <p className="hint">
              Tip: if nothing happens after authorizing, click{' '}
              <strong>Sign in with GitHub</strong> again — the browser may
              not have re-handed control back.
            </p>
          )}

          {phase.kind === 'error' && (
            <div className="picg-banner">{phase.message}</div>
          )}

          <div className="advanced">
            <Link href="/desktop/login/token" className="picg-back-link">
              Use a personal access token instead
            </Link>
          </div>
        </section>
      </main>

      <DesktopTheme />
      <style jsx>{`
        .hero { margin-bottom: 32px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 56px;
          font-weight: 400;
          letter-spacing: -0.01em;
          margin: 0 0 8px;
          color: var(--text);
        }
        .meta {
          margin: 0;
          color: var(--text-muted);
          font-size: 14px;
        }

        .card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 28px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .hint {
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
          margin: 0;
        }
        .hint strong { color: var(--text); font-weight: 500; }
        .advanced {
          margin-top: 8px;
          padding-top: 14px;
          border-top: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
