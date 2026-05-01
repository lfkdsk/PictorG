'use client';

// Shared chrome for the desktop spike pages (/desktop/*). Both Topbar and
// DesktopTheme are injected by every desktop page; keeping them here avoids
// the duplication that would otherwise drift between pages. Modal helper
// classes live in the global theme block so styled-jsx scoping can't
// accidentally break their layout.

import { useEffect, useState } from 'react';

import { getGitHubToken, logout } from '@/lib/github';
import { getStoredUser, type GitHubUser } from '@/lib/auth';

export function Topbar() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Cached user is only populated by the OAuth callback at "/", so PAT-login
  // sessions land here with no avatar. Fall back to the GitHub /user endpoint
  // when the cache is empty but a token exists — same dance as Navbar.
  useEffect(() => {
    const stored = getStoredUser();
    if (stored?.avatar_url) {
      setUser(stored);
      return;
    }

    const token = getGitHubToken();
    if (!token) return;

    let cancelled = false;
    fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.avatar_url) return;
        setUser(data as GitHubUser);
        try {
          localStorage.setItem('gh_user', JSON.stringify(data));
        } catch {
          /* quota / disabled — non-fatal */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <span className="brand-name">Pictor</span>
      </div>
      {user && (
        <div className="user-wrap">
          <button
            className="user-pill"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
          >
            <img src={user.avatar_url} alt="" className="avatar" />
            <span className="user-login">{user.login}</span>
          </button>
          {menuOpen && (
            <>
              <div className="menu-overlay" onClick={() => setMenuOpen(false)} />
              <div className="menu">
                <button className="menu-item" onClick={() => logout()}>
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <style jsx>{`
        .topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 40px;
          border-bottom: 1px solid var(--border);
        }
        .brand { display: flex; align-items: center; gap: 10px; }
        .brand-mark {
          width: 28px; height: 28px;
          display: grid; place-items: center;
          background: var(--text);
          color: var(--bg);
          border-radius: 7px;
          font-family: var(--serif);
          font-weight: 700;
          font-size: 16px;
        }
        .brand-name {
          font-family: var(--serif);
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--text);
        }
        .user-wrap { position: relative; }
        .user-pill {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 12px 4px 4px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 999px;
          color: var(--text);
          cursor: pointer;
          font-family: inherit; font-size: 13px;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .user-pill:hover {
          border-color: var(--border-strong);
          background: var(--bg-card-hover);
        }
        .avatar {
          width: 24px; height: 24px;
          border-radius: 50%;
          object-fit: cover;
          background: var(--bg-card-hover);
        }
        .user-login { font-family: var(--mono); font-size: 12px; }
        .menu-overlay {
          position: fixed; inset: 0; z-index: 100;
        }
        .menu {
          position: absolute; top: calc(100% + 6px); right: 0;
          min-width: 140px;
          background: var(--bg-card);
          border: 1px solid var(--border-strong);
          border-radius: 8px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
          padding: 4px;
          z-index: 101;
        }
        .menu-item {
          display: block;
          width: 100%;
          padding: 8px 12px;
          background: transparent;
          border: 0;
          color: var(--text);
          font-family: inherit;
          font-size: 13px;
          text-align: left;
          cursor: pointer;
          border-radius: 6px;
        }
        .menu-item:hover { background: var(--bg-card-hover); }
      `}</style>
    </header>
  );
}

export function DesktopTheme() {
  return (
    <style jsx global>{`
      :root {
        --bg: #0d0b08;
        --bg-card: #181510;
        --bg-card-hover: #201c16;
        --bg-card-warm: #1a1610;
        --border: rgba(232, 220, 196, 0.08);
        --border-strong: rgba(232, 220, 196, 0.18);
        --text: #ebdfc6;
        --text-muted: #8b8275;
        --text-faint: #5c5650;
        --accent: #e8a04a;
        --accent-hover: #f0ad5b;
        --accent-text: #1a1308;
        --serif: ui-serif, "PT Serif", "Source Serif Pro", Georgia, "Times New Roman", serif;
        --mono: ui-monospace, "SF Mono", Menlo, "Roboto Mono", monospace;
      }
      html, body { background: var(--bg); color: var(--text); }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      /* Root layout wraps children in <main class="container"> with a
         max-width and padding — desktop pages own their full layout. */
      .container {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .page { min-height: 100vh; }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 16px;
        border-radius: 8px;
        border: 1px solid transparent;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        text-decoration: none;
      }
      .btn.primary { background: var(--accent); color: var(--accent-text); }
      .btn.primary:hover { background: var(--accent-hover); }
      .btn.ghost {
        background: transparent;
        border-color: var(--border-strong);
        color: var(--text-muted);
      }
      .btn.ghost:hover {
        background: var(--bg-card-hover);
        color: var(--text);
        border-color: var(--border-strong);
      }
      .btn.ghost.small {
        padding: 5px 10px;
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        font-family: var(--mono);
      }
      .btn.ghost.icon { padding: 4px 10px; font-size: 14px; }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Back link — global because styled-jsx occasionally misses next/link's
         rendered <a> when the page also has many scoped rules. */
      .picg-back-link {
        display: inline-block;
        margin-bottom: 24px;
        color: var(--text-muted);
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        text-decoration: none;
        transition: color 0.15s ease;
      }
      .picg-back-link:hover { color: var(--accent); }

      /* Card → detail link wrapping a serif title. Same scoping caution. */
      .picg-card-link { text-decoration: none; color: inherit; display: block; }
      .picg-card-link:hover .card-title { color: var(--accent); }

      /* Modal — global so styled-jsx scoping can't accidentally break it. */
      .picg-modal-backdrop {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        z-index: 200;
        animation: picg-fade 0.15s ease;
      }
      @keyframes picg-fade { from { opacity: 0 } to { opacity: 1 } }
      .picg-modal {
        background: var(--bg-card);
        border: 1px solid var(--border-strong);
        border-radius: 16px;
        padding: 20px;
        width: 540px; max-width: calc(100vw - 64px);
        max-height: 70vh;
        display: flex; flex-direction: column;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      }
      .picg-modal-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 16px;
      }
      .picg-modal-header h2 {
        font-family: var(--serif); font-weight: 400; font-size: 22px;
        margin: 0; letter-spacing: -0.01em;
      }
      .picg-modal-filter {
        width: 100%;
        padding: 10px 14px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--text);
        font-family: inherit;
        font-size: 14px;
        margin-bottom: 14px;
        box-sizing: border-box;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .picg-modal-filter:focus { border-color: var(--accent); }
      .picg-modal-filter::placeholder { color: var(--text-faint); }
      .picg-repo-list {
        overflow-y: auto;
        display: flex; flex-direction: column; gap: 2px;
        margin: -4px;
        padding: 4px;
      }
      .picg-repo-item {
        display: flex; gap: 12px; align-items: center;
        padding: 10px 12px;
        background: transparent;
        border: 0;
        border-radius: 8px;
        color: var(--text);
        font-family: var(--mono);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background 0.1s ease;
      }
      .picg-repo-item:hover:not(:disabled) { background: var(--bg-card-hover); }
      .picg-repo-item:disabled { color: var(--text-faint); cursor: not-allowed; }
      .picg-repo-name { flex: 1; }
      .picg-repo-tags { display: flex; gap: 6px; }
      .picg-badge {
        padding: 2px 8px;
        font-size: 10px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        background: rgba(232, 160, 74, 0.12);
        color: var(--accent);
        border-radius: 999px;
      }
      .picg-badge.muted {
        background: rgba(232, 220, 196, 0.06);
        color: var(--text-muted);
      }
      .picg-modal-loading {
        padding: 24px;
        text-align: center;
        color: var(--text-muted);
        font-family: var(--mono);
        font-size: 12px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
    `}</style>
  );
}
