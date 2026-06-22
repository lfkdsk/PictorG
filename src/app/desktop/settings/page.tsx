'use client';

import { useRouter } from 'next/navigation';

import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { SettingsPanel } from '@/components/desktop/SettingsPanel';

// Standalone /desktop/settings route. The same form also renders in a modal
// from the topbar (see DesktopChrome) so settings can be tweaked mid-task
// without navigating away; this route remains for direct/deep-link access.
export default function DesktopSettingsPage() {
  const router = useRouter();

  // Reachable from the account menu on every desktop screen, so "back" returns
  // wherever the user came from. Fall back to galleries if there's no history.
  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/desktop/galleries');
    }
  }

  return (
    <div className="page">
      <Topbar />

      <main>
        <button type="button" onClick={handleBack} className="picg-back-link back-btn">
          ← Back
        </button>

        <section className="hero">
          <h1>Settings</h1>
          <p className="meta">Compression preferences are saved locally.</p>
        </section>

        <SettingsPanel />
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 760px; margin: 0 auto; }

        /* Reset native button chrome so it reads as the shared back link. */
        .back-btn { background: none; border: 0; padding: 0; cursor: pointer; }

        .hero { margin-bottom: 32px; }
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
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
