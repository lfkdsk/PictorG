'use client';

// Shared chrome for the desktop spike pages (/desktop/*). Both Topbar and
// DesktopTheme are injected by every desktop page; keeping them here avoids
// the duplication that would otherwise drift between pages. Modal helper
// classes live in the global theme block so styled-jsx scoping can't
// accidentally break their layout.

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';

import { clearGitHubToken, getGitHubToken } from '@/lib/github';
import { getStoredUser, type GitHubUser } from '@/lib/auth';
import { getPicgBridge } from '@/core/storage';
import { InfoToastHost, fireInfoToast } from '@/components/desktop/InfoToast';

// Topbar accepts an optional `actions` slot rendered between the brand
// and the user pill. Per-page chrome (sync icons, etc.) goes here so
// the page hero stays focused on content.
export function Topbar({ actions }: { actions?: ReactNode }) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Set when a newer version is on the GitHub release page. The pill
  // doesn't trigger a download — it opens the release page in the
  // user's browser, since unsigned macOS builds can't use Squirrel's
  // silent install. See electron/updater.ts for the rationale.
  const [updateAvailable, setUpdateAvailable] = useState<{
    version: string;
    releaseUrl: string;
  } | null>(null);

  // Subscribe to updater "available" broadcasts AND replay any update
  // that was already detected before this Topbar mounted. The replay
  // matters because the broadcast fires once per check — if the user
  // was mid-navigation when it landed, the listener wasn't attached
  // yet. On mount we ask main "is there a pending update?" and fill
  // the pill from that cached state.
  useEffect(() => {
    const bridge = getPicgBridge();
    if (!bridge?.updater) return;
    bridge.updater
      .getPending()
      .then((pending) => {
        if (pending) setUpdateAvailable(pending);
      })
      .catch(() => {
        /* old preload without getPending — fall back to live event */
      });
    const offAvailable = bridge.updater.onUpdateAvailable((info) => {
      setUpdateAvailable({
        version: info.version,
        releaseUrl: info.releaseUrl,
      });
    });
    // Background-poll errors used to be completely silent — surface
    // them as error toasts so the user has SOME signal when the
    // updater can't reach GitHub.
    const offError = bridge.updater.onUpdateError((info) => {
      fireInfoToast({
        message: `Update check failed: ${info.message}`,
        kind: 'error',
      });
    });
    return () => {
      offAvailable();
      offError();
    };
  }, []);

  async function handleDownloadUpdate() {
    const bridge = getPicgBridge();
    if (!bridge?.updater) return;
    await bridge.updater.openReleasePage();
  }

  async function handleManualCheck() {
    const bridge = getPicgBridge();
    if (!bridge?.updater) return;
    setMenuOpen(false);
    try {
      const r = await bridge.updater.checkNow();
      if (!r.ok) {
        fireInfoToast({ message: `Update check failed: ${r.error}`, kind: 'error' });
        return;
      }
      if (r.available) {
        setUpdateAvailable(r.available);
        fireInfoToast({
          message: `Update ${r.available.version} available — click the topbar pill to download.`,
        });
        return;
      }
      if (r.updateAvailable && r.manifestVersion) {
        // Manifest says newer version exists but the broadcast hasn't
        // landed yet (race between check resolution and the
        // update-available event firing). Synthesize the pill state
        // ourselves so the user gets immediate feedback.
        setUpdateAvailable({
          version: r.manifestVersion,
          releaseUrl: r.releaseUrl,
        });
        fireInfoToast({
          message: `Update ${r.manifestVersion} available — click the topbar pill to download.`,
        });
        return;
      }
      fireInfoToast({
        message: `You're on the latest version (${r.currentVersion}).`,
      });
    } catch (err) {
      fireInfoToast({
        message: `Update check failed: ${err instanceof Error ? err.message : err}`,
        kind: 'error',
      });
    }
  }

  // Boot order:
  //   1. Cached gh_user → avatar pill straight away.
  //   2. localStorage gh_token → fetch /user, populate avatar.
  //   3. (desktop only) macOS Keychain → restore localStorage if it was
  //      cleared, then go through (2). The Keychain copy is the durable
  //      source of truth; localStorage is the renderer's fast cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = getStoredUser();
      if (stored?.avatar_url) {
        setUser(stored);
        return;
      }

      let token = getGitHubToken();

      if (!token) {
        const bridge = getPicgBridge();
        if (bridge) {
          try {
            const fromKeychain = await bridge.auth.getToken();
            if (fromKeychain && !cancelled) {
              localStorage.setItem('gh_token', fromKeychain);
              token = fromKeychain;
            }
          } catch {
            /* keychain unavailable; fall through */
          }
        }
      }

      if (!token || cancelled) return;

      try {
        const r = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
          },
        });
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (cancelled || !data?.avatar_url) return;
        setUser(data as GitHubUser);
        try {
          localStorage.setItem('gh_user', JSON.stringify(data));
        } catch {
          /* quota / disabled — non-fatal */
        }
      } catch {
        /* network error during /user fetch is non-fatal here */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    // Clear the durable on-disk copy first (was Keychain, now
    // <userData>/auth.json) so a stale token can't "restore" us into a
    // logged-in state on next launch.
    const bridge = getPicgBridge();
    if (bridge) {
      try {
        await bridge.auth.clearToken();
      } catch {
        /* ignore */
      }
    }
    // Don't call the shared logout() — it redirects to /login, which is
    // the web sign-in page. Desktop has its own /desktop/login. We
    // still clear the renderer-side localStorage token via
    // clearGitHubToken (re-exported through getGitHubToken's module),
    // then hard-nav to the desktop login.
    clearGitHubToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/desktop/login';
    }
  }

  return (
    <>
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <span className="brand-name">Pictor</span>
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
      {updateAvailable && (
        <button
          type="button"
          className="picg-update-pill"
          onClick={handleDownloadUpdate}
          title={`Open the GitHub release page to download v${updateAvailable.version}`}
        >
          <span className="picg-update-pill-dot" aria-hidden="true" />
          <span className="picg-update-pill-text">
            v{updateAvailable.version} available · Download
          </span>
        </button>
      )}
      {user && (
        <div className="picg-menu-anchor">
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
              <div className="picg-menu-overlay" onClick={() => setMenuOpen(false)} />
              <div className="picg-menu" role="menu">
                <Link
                  href="/desktop/settings"
                  className="picg-menu-item"
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  className="picg-menu-item"
                  onClick={handleManualCheck}
                  role="menuitem"
                >
                  Check for updates…
                </button>
                <div className="picg-menu-divider" />
                <button
                  type="button"
                  className="picg-menu-item"
                  onClick={handleLogout}
                  role="menuitem"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <style jsx>{`
        .topbar {
          display: flex; align-items: center; gap: 12px;
          /* Left padding clears the macOS traffic lights that the
             titleBarStyle: 'hiddenInset' window leaves floating over our
             content. Right side keeps the regular margin. */
          padding: 10px 24px 10px 86px;
          border-bottom: 1px solid var(--border);
          /* Whole bar is the window drag handle. Buttons inside opt out so
             they remain clickable. */
          -webkit-app-region: drag;
          user-select: none;
        }
        .topbar :global(button),
        .topbar :global(a),
        .topbar :global(input),
        .topbar :global(.picg-menu),
        .topbar :global(.picg-menu-overlay) {
          -webkit-app-region: no-drag;
        }
        .brand {
          display: flex; align-items: center; gap: 10px;
          margin-right: auto;
        }
        .topbar-actions {
          display: flex; align-items: center; gap: 4px;
        }
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

        .picg-update-pill {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 12px;
          background: rgba(217, 119, 87, 0.12);
          border: 1px solid rgba(217, 119, 87, 0.45);
          border-radius: 999px;
          color: var(--accent);
          cursor: pointer;
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .picg-update-pill:hover {
          background: rgba(217, 119, 87, 0.22);
          border-color: var(--accent);
        }
        .picg-update-pill-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
          /* Tiny pulse so users notice it land in the topbar */
          animation: picg-update-pulse 2s ease-in-out infinite;
        }
        @keyframes picg-update-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        .picg-update-pill-text { white-space: nowrap; }
      `}</style>
    </header>
    <InfoToastHost />
    </>
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
      .btn.danger {
        color: #f0857b;
        border-color: rgba(216, 90, 70, 0.4);
      }
      .btn.danger:hover {
        color: #ff7b72;
        border-color: rgba(216, 90, 70, 0.6);
        background: rgba(216, 90, 70, 0.08);
      }
      .btn.primary.danger {
        background: #c84a44;
        color: #fff;
      }
      .btn.primary.danger:hover { background: #d65a55; }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .picg-confirm-text {
        margin: 0;
        font-size: 14px;
        color: var(--text);
      }
      .picg-confirm-text strong {
        font-family: var(--serif);
        font-weight: 600;
      }

      /* Icon-only button (e.g. ⋯ "more actions"). Ghost transparent
         until hover, then a soft fill — sits next to a primary CTA
         without competing visually. */
      .picg-icon-btn {
        width: 36px; height: 36px;
        border-radius: 8px;
        background: transparent;
        border: 0;
        color: var(--text-muted);
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        display: grid; place-items: center;
        transition: background 0.15s ease, color 0.15s ease;
        font-family: inherit;
        padding: 0;
      }
      .picg-icon-btn:hover { background: var(--bg-card-hover); color: var(--text); }
      .picg-icon-btn[aria-expanded="true"] {
        background: var(--bg-card-hover);
        color: var(--text);
      }
      .picg-icon-btn:disabled { opacity: 0.6; cursor: wait; }
      .picg-icon-btn { position: relative; }
      .picg-icon-btn .picg-spin {
        display: inline-block;
        animation: picg-spin 0.9s linear infinite;
      }
      @keyframes picg-spin { to { transform: rotate(360deg); } }
      /* Thin progress bar for batch operations (compression queue, etc) */
      .picg-progress-bar {
        height: 3px;
        background: rgba(232, 220, 196, 0.08);
        border-radius: 2px;
        overflow: hidden;
        margin: 0 0 14px;
      }
      .picg-progress-fill {
        height: 100%;
        background: var(--accent);
        transition: width 0.25s ease;
      }

      .picg-badge-count {
        position: absolute;
        top: -2px;
        right: -2px;
        min-width: 16px;
        height: 16px;
        padding: 0 5px;
        background: var(--accent);
        color: var(--accent-text);
        font-family: var(--mono);
        font-size: 9px;
        font-weight: 700;
        line-height: 16px;
        text-align: center;
        border-radius: 999px;
        border: 1px solid var(--bg);
        box-sizing: border-box;
      }

      /* Anchor for popovers — wrap the trigger + menu in this so the
         absolute-positioned menu lines up under the trigger. */
      .picg-menu-anchor { position: relative; }
      .picg-menu-overlay {
        position: fixed; inset: 0; z-index: 100;
      }
      .picg-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 180px;
        background: var(--bg-card);
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        padding: 4px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
        z-index: 101;
      }
      .picg-menu-item {
        display: block;
        width: 100%;
        padding: 9px 12px;
        background: transparent;
        border: 0;
        color: var(--text);
        font-family: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        border-radius: 6px;
        text-decoration: none;
        line-height: 1.3;
      }
      .picg-menu-item:hover:not(:disabled) { background: var(--bg-card-hover); }
      .picg-menu-item:disabled { opacity: 0.4; cursor: not-allowed; }
      .picg-menu-item.danger { color: #f0857b; }
      .picg-menu-item.danger:hover:not(:disabled) {
        background: rgba(216, 90, 70, 0.12);
        color: #ff7b72;
      }
      .picg-menu-divider {
        height: 1px;
        background: var(--border);
        margin: 4px 0;
      }

      /* Year card on /desktop/galleries/[id]/annual-summary */
      .year-card {
        display: flex; flex-direction: column; gap: 12px;
        padding: 24px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 14px;
        text-decoration: none;
        color: inherit;
        cursor: pointer;
        transition: border-color 0.15s ease, transform 0.1s ease;
      }
      .year-card:hover {
        border-color: var(--border-strong);
        transform: translateY(-2px);
      }
      .year-card .year {
        font-family: var(--serif);
        font-size: 36px;
        font-weight: 400;
        letter-spacing: -0.01em;
        color: var(--text);
        line-height: 1;
      }
      .year-card .status { display: flex; }
      .year-card .badge {
        font-family: var(--mono);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 3px 8px;
        border-radius: 999px;
      }
      .year-card .badge.filled {
        background: rgba(232, 160, 74, 0.16);
        color: var(--accent);
      }
      .year-card .badge.empty {
        background: rgba(232, 220, 196, 0.06);
        color: var(--text-muted);
      }

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

      /* Album card (detail page → album list) */
      .picg-album-card {
        display: flex; flex-direction: column; gap: 8px;
        text-decoration: none; color: inherit;
        cursor: pointer;
        outline: none;
      }
      .picg-album-card:focus-visible .picg-album-cover {
        border-color: var(--accent);
      }
      .picg-album-card.is-dragging { opacity: 0.4; }
      .picg-album-card.is-drop-target .picg-album-cover {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px rgba(232, 160, 74, 0.32);
      }
      .picg-album-cover {
        position: relative;
        aspect-ratio: 4 / 3;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
      }
      .picg-album-card:hover .picg-album-cover {
        border-color: var(--border-strong);
        transform: translateY(-2px);
      }
      .picg-album-cover img {
        width: 100%; height: 100%;
        object-fit: cover;
        display: block;
      }
      .picg-album-cover-placeholder {
        width: 100%; height: 100%;
        background: linear-gradient(135deg, var(--bg-card-hover), var(--bg-card));
      }
      .picg-album-cover-error {
        position: absolute; inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center; justify-content: center;
        gap: 6px;
        color: var(--text-muted);
        font-family: var(--mono);
        font-size: 10px;
        padding: 14px;
        text-align: center;
        line-height: 1.4;
        background: rgba(216, 90, 70, 0.08);
        border: 1px dashed rgba(216, 90, 70, 0.32);
        border-radius: inherit;
      }
      .picg-album-cover-error strong {
        color: #f0bfb6;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-size: 10px;
      }
      .picg-album-cover-error span {
        color: var(--text-faint);
        word-break: break-word;
      }
      .picg-album-name {
        font-family: var(--serif);
        font-size: 18px;
        font-weight: 400;
        letter-spacing: -0.01em;
        color: var(--text);
        line-height: 1.25;
      }
      .picg-album-card:hover .picg-album-name { color: var(--accent); }
      .picg-album-meta {
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--text-muted);
        display: flex; gap: 6px; align-items: center;
      }
      .picg-album-meta-dot { color: var(--text-faint); }

      /* Thumbnail grid (album page) */
      .picg-thumbs {
        list-style: none; margin: 0; padding: 0;
        display: grid; gap: 8px;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      }
      .picg-thumb {
        position: relative;
        aspect-ratio: 1 / 1;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        transition: border-color 0.15s ease, transform 0.1s ease;
        padding: 0;
      }
      .picg-thumb:hover {
        border-color: var(--border-strong);
        transform: translateY(-1px);
      }
      .picg-thumb img {
        width: 100%; height: 100%;
        object-fit: cover;
        display: block;
      }
      .picg-thumb-placeholder {
        width: 100%; height: 100%;
        background: linear-gradient(135deg, var(--bg-card-hover), var(--bg-card));
      }
      .picg-thumb.is-cover {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px rgba(232, 160, 74, 0.32);
      }
      .picg-thumb.is-selected {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px rgba(232, 160, 74, 0.32);
      }
      .picg-thumb-check {
        position: absolute;
        top: 8px; right: 8px;
        width: 22px; height: 22px;
        border-radius: 50%;
        background: var(--accent);
        color: var(--accent-text);
        font-size: 13px;
        font-weight: 700;
        display: grid; place-items: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }

      /* Lightbox */
      .picg-lightbox {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.92);
        display: flex; align-items: center; justify-content: center;
        z-index: 300;
        padding: 32px;
        animation: picg-fade 0.15s ease;
      }
      .picg-lightbox img {
        max-width: 100%; max-height: 100%;
        object-fit: contain;
        border-radius: 4px;
        box-shadow: 0 8px 48px rgba(0, 0, 0, 0.6);
      }
      .picg-lightbox-meta {
        position: absolute; bottom: 24px; left: 50%;
        transform: translateX(-50%);
        background: rgba(20, 18, 14, 0.85);
        backdrop-filter: blur(8px);
        padding: 8px 16px;
        border-radius: 999px;
        color: var(--text);
        font-family: var(--mono);
        font-size: 12px;
        letter-spacing: 0.04em;
        display: flex; gap: 12px; align-items: center;
      }
      .picg-lightbox-close {
        position: absolute; top: 24px; right: 24px;
        background: rgba(20, 18, 14, 0.7);
        backdrop-filter: blur(8px);
        border: 0;
        width: 36px; height: 36px;
        border-radius: 50%;
        color: var(--text);
        font-size: 18px;
        cursor: pointer;
        display: grid; place-items: center;
      }
      .picg-lightbox-close:hover { background: rgba(20, 18, 14, 0.95); }

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
      .picg-modal-wide { width: 600px; }
      /* Side-by-side compare / preview shell — needs a much wider canvas
         and zero outer padding so the inner layout (head / panes / footer)
         owns its own spacing without doubling up on .picg-modal's defaults. */
      .picg-modal-xwide {
        width: 1280px;
        max-width: calc(100vw - 48px);
        max-height: calc(100vh - 48px);
        padding: 0;
        overflow: hidden;
      }
      .picg-modal-actions {
        display: flex; gap: 8px; justify-content: flex-end;
        margin-top: 18px;
      }

      /* Form fields shared by modals + create-album page */
      .picg-fields {
        display: flex; flex-direction: column; gap: 14px;
        overflow-y: auto;
      }
      .picg-field { display: flex; flex-direction: column; gap: 6px; }
      .picg-field > span {
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--text-faint);
      }
      .picg-field input, .picg-field select {
        padding: 10px 12px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--text);
        font-family: inherit;
        font-size: 14px;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .picg-field input:focus, .picg-field select:focus { border-color: var(--accent); }
      .picg-field input::placeholder { color: var(--text-faint); }
      .picg-field input:disabled, .picg-field select:disabled { opacity: 0.6; }
      .picg-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

      .picg-banner {
        background: rgba(216, 90, 70, 0.12);
        border: 1px solid rgba(216, 90, 70, 0.32);
        color: #f0bfb6;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-family: var(--mono);
      }
      .picg-warning {
        background: rgba(232, 160, 74, 0.10);
        border: 1px solid rgba(232, 160, 74, 0.32);
        color: var(--accent);
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.5;
      }
      .picg-warning code {
        font-family: var(--mono);
        background: rgba(0, 0, 0, 0.25);
        padding: 1px 6px;
        border-radius: 4px;
      }

      /* Modal-header layout adjustment for the back-arrow case (e.g. cover
         picker inside the edit-album modal). */
      .picg-modal-title-wrap {
        display: flex; align-items: center; gap: 6px; min-width: 0;
      }
      .picg-modal-title-wrap h2 { margin: 0; }

      /* Cover field: small thumbnail + path + Change button */
      .picg-cover-field {
        display: flex; align-items: center; gap: 12px;
        padding: 8px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      .picg-cover-preview {
        width: 56px; height: 56px;
        flex-shrink: 0;
        border-radius: 6px;
        overflow: hidden;
        background: var(--bg-card-hover);
      }
      .picg-cover-preview img { width: 100%; height: 100%; object-fit: cover; }
      .picg-cover-empty {
        width: 100%; height: 100%;
        display: grid; place-items: center;
        color: var(--text-faint);
        font-family: var(--mono);
        font-size: 9px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .picg-cover-meta {
        flex: 1; min-width: 0;
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px;
      }
      .picg-cover-path {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1; min-width: 0;
      }

      /* Cover picker view inside the edit-album modal */
      .picg-cover-picker {
        overflow-y: auto;
        max-height: 56vh;
        margin: -4px;
        padding: 4px;
      }
      .picg-cover-picker .picg-thumbs {
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      }
    `}</style>
  );
}
