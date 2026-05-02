'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { getPicgBridge } from '@/core/storage';
import { validateGitHubToken, clearGitHubToken } from '@/lib/github';
import { storeAuthData, type GitHubUser } from '@/lib/auth';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';

const TOKEN_HELP_URL = 'https://github.com/settings/tokens';

export default function DesktopTokenLoginPage() {
  const [bridge, setBridge] = useState(() => getPicgBridge());
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBridge(getPicgBridge());
    // Wipe any stale token from a previous session so a bad value doesn't
    // sit there pretending to be valid until the next API call fails.
    clearGitHubToken();
  }, []);

  async function handleSubmit() {
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Token is required.');
      return;
    }
    setValidating(true);
    setError(null);
    try {
      const ok = await validateGitHubToken(trimmed);
      if (!ok) {
        setError("Token didn't validate. Check the value and that it has `repo` scope.");
        return;
      }

      // Resolve the user so the avatar shows up in the Topbar without a
      // second fetch on the next page.
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${trimmed}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (!userRes.ok) {
        setError(`Could not fetch user: ${userRes.status}`);
        return;
      }
      const user = (await userRes.json()) as GitHubUser;
      storeAuthData(trimmed, user);

      window.location.assign('/desktop/galleries');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  function openHelp(e: React.MouseEvent) {
    // In Electron, route through bridge.auth.openExternal so the link
    // opens in the system browser instead of replacing the renderer.
    if (bridge) {
      e.preventDefault();
      bridge.auth.openExternal(TOKEN_HELP_URL).catch(() => {});
    }
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
        <Link href="/desktop/login" className="picg-back-link">
          ← Sign in
        </Link>

        <section className="hero">
          <h1>Use a token</h1>
          <p className="meta">
            Paste a personal access token with <code>repo</code> scope.
          </p>
        </section>

        <section className="card">
          <label className="picg-field">
            <span>GitHub token</span>
            <input
              type="password"
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              placeholder="ghp_…"
              disabled={validating}
            />
          </label>

          {error && <div className="picg-banner">{error}</div>}

          <div className="actions">
            <button
              type="button"
              className="btn primary"
              onClick={handleSubmit}
              disabled={validating || !token.trim()}
            >
              {validating ? 'Validating…' : 'Sign in'}
            </button>
            <a
              href={TOKEN_HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="picg-back-link"
              onClick={openHelp}
            >
              Generate one →
            </a>
          </div>
        </section>
      </main>

      <DesktopTheme />
      <style jsx>{`
        .hero { margin-bottom: 24px; }
        .hero h1 {
          font-family: var(--serif);
          font-size: 48px;
          font-weight: 400;
          letter-spacing: -0.01em;
          margin: 0 0 6px;
          color: var(--text);
        }
        .meta {
          margin: 0;
          color: var(--text-muted);
          font-size: 13px;
        }
        .meta code {
          font-family: var(--mono);
          background: var(--bg-card);
          color: var(--text);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 12px;
        }

        .card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 24px;
          display: flex; flex-direction: column; gap: 16px;
        }

        .actions {
          display: flex; align-items: center; gap: 16px;
        }
      `}</style>
    </div>
  );
}
