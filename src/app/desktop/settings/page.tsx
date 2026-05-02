'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  getCompressionSettings,
  saveCompressionSettings,
  type CompressionSettings,
} from '@/lib/settings';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';

export default function DesktopSettingsPage() {
  const [settings, setSettings] = useState<CompressionSettings>(() =>
    getCompressionSettings()
  );

  useEffect(() => {
    setSettings(getCompressionSettings());
  }, []);

  function update(patch: Partial<CompressionSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveCompressionSettings(next);
  }

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href="/desktop/galleries" className="picg-back-link">
          ← All galleries
        </Link>

        <section className="hero">
          <h1>Settings</h1>
          <p className="meta">Compression preferences are saved locally.</p>
        </section>

        <section className="block">
          <h2>Image compression</h2>

          <div className="row">
            <div className="row-text">
              <div className="row-title">Enable image compression</div>
              <div className="row-desc">
                Re-encodes uploads through squoosh to shrink file size before commit.
              </div>
            </div>
            <Toggle
              checked={settings.enableWebP}
              onChange={(v) => update({ enableWebP: v })}
            />
          </div>

          <div className="row">
            <div className="row-text">
              <div className="row-title">Preserve EXIF metadata</div>
              <div className="row-desc">
                Keep camera info, timestamp, GPS embedded in the compressed file.
              </div>
            </div>
            <Toggle
              checked={settings.preserveEXIF}
              onChange={(v) => update({ preserveEXIF: v })}
              disabled={!settings.enableWebP}
            />
          </div>

          <div className="row">
            <div className="row-text">
              <div className="row-title">Output format</div>
              <div className="row-desc">Format the compressor writes after re-encoding.</div>
            </div>
            <div className="format-options">
              <FormatOption
                label="WebP"
                hint="smaller, modern"
                value="webp"
                selected={settings.outputFormat === 'webp'}
                onSelect={() => update({ outputFormat: 'webp' })}
                disabled={!settings.enableWebP}
              />
              <FormatOption
                label="JPEG"
                hint="universal"
                value="jpeg"
                selected={settings.outputFormat === 'jpeg'}
                onSelect={() => update({ outputFormat: 'jpeg' })}
                disabled={!settings.enableWebP}
              />
            </div>
          </div>
        </section>
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 760px; margin: 0 auto; }

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

        .block {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 4px 20px;
        }
        .block h2 {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 500;
          margin: 18px 0 12px;
        }

        .row {
          display: flex; align-items: center; gap: 16px;
          padding: 16px 0;
          border-top: 1px solid var(--border);
        }
        .row-text { flex: 1; min-width: 0; }
        .row-title {
          font-size: 14px;
          color: var(--text);
          margin-bottom: 4px;
        }
        .row-desc {
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }

        .format-options {
          display: flex; flex-direction: column; gap: 6px;
          min-width: 200px;
        }
      `}</style>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`toggle ${checked ? 'on' : ''}`}
    >
      <span className="dot" />
      <style jsx>{`
        .toggle {
          flex-shrink: 0;
          width: 40px; height: 22px;
          padding: 2px;
          border-radius: 999px;
          background: rgba(232, 220, 196, 0.12);
          border: 0;
          cursor: pointer;
          transition: background 0.15s ease;
          display: flex; align-items: center;
        }
        .toggle.on { background: var(--accent); }
        .toggle:disabled { opacity: 0.4; cursor: not-allowed; }
        .dot {
          width: 18px; height: 18px;
          border-radius: 50%;
          background: var(--bg);
          transition: transform 0.15s ease;
        }
        .toggle.on .dot { transform: translateX(18px); background: var(--accent-text); }
      `}</style>
    </button>
  );
}

function FormatOption({
  label,
  hint,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  hint: string;
  value: 'webp' | 'jpeg';
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`opt ${selected ? 'selected' : ''}`}
    >
      <span className="dot" />
      <span className="label">{label}</span>
      <span className="hint">{hint}</span>
      <style jsx>{`
        .opt {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
          text-align: left;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .opt:hover:not(:disabled) { border-color: var(--border-strong); }
        .opt.selected { border-color: var(--accent); }
        .opt:disabled { opacity: 0.5; cursor: not-allowed; }
        .dot {
          width: 12px; height: 12px;
          border-radius: 50%;
          border: 1px solid var(--border-strong);
          flex-shrink: 0;
        }
        .opt.selected .dot {
          border-color: var(--accent);
          background: radial-gradient(circle, var(--accent) 0 4px, transparent 5px);
        }
        .label { font-weight: 500; }
        .hint {
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-faint);
        }
      `}</style>
    </button>
  );
}
