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
                disabled={!settings.enableWebP || settings.lossless}
              />
            </div>
          </div>

          <details className="advanced">
            <summary>Advanced</summary>
            <div className="advanced-body">
              <div className="row">
                <div className="row-text">
                  <div className="row-title">Lossless mode</div>
                  <div className="row-desc">
                    Pixel-perfect WebP output — no quality loss, no resize cap.
                    Files are 5–10× larger than the default lossy mode but
                    typically still smaller than the source. JPEG output is
                    disabled while this is on.
                  </div>
                </div>
                <Toggle
                  checked={settings.lossless}
                  onChange={(v) =>
                    update({
                      lossless: v,
                      // Lossless only makes sense for WebP — flip to webp on enable.
                      ...(v ? { outputFormat: 'webp' as const } : {}),
                    })
                  }
                  disabled={!settings.enableWebP}
                />
              </div>

              <div className="row">
                <div className="row-text">
                  <div className="row-title">
                    Quality <span className="row-value">{settings.quality}</span>
                  </div>
                  <div className="row-desc">
                    Encoder quality for WebP-lossy and JPEG. 75 is the
                    sweet-spot default. Below ~60 starts showing artefacts;
                    above 85 file size grows fast for diminishing visible gain.
                    Ignored in lossless mode.
                  </div>
                </div>
                <Slider
                  value={settings.quality}
                  min={50}
                  max={95}
                  step={1}
                  onChange={(v) => update({ quality: v })}
                  disabled={!settings.enableWebP || settings.lossless}
                />
              </div>

              <div className="row">
                <div className="row-text">
                  <div className="row-title">
                    WebP effort <span className="row-value">{settings.webpEffort}</span>
                  </div>
                  <div className="row-desc">
                    How hard libwebp searches for redundant patterns.
                    6 = best size, ~30 % slower than 4. JPEG ignores
                    this. Drop it if you're batch-uploading hundreds
                    of photos and the encode wait bothers you.
                  </div>
                </div>
                <Slider
                  value={settings.webpEffort}
                  min={0}
                  max={6}
                  step={1}
                  onChange={(v) => update({ webpEffort: v })}
                  disabled={!settings.enableWebP || settings.outputFormat !== 'webp'}
                />
              </div>

              <div className="row">
                <div className="row-text">
                  <div className="row-title">Max output size</div>
                  <div className="row-desc">
                    Photos above this are scaled down before encoding;
                    those at or below pass through at native resolution.
                    50 MP catches medium-format and 100 MP mirrorless
                    output without touching DSLRs or phones. "No cap"
                    is equivalent to lossless mode for sizing purposes.
                  </div>
                </div>
                <MaxMpSelect
                  value={settings.maxMegapixels}
                  onChange={(v) => update({ maxMegapixels: v })}
                  disabled={!settings.enableWebP || settings.lossless}
                />
              </div>
            </div>
          </details>
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

        .row-value {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-muted);
          margin-left: 6px;
          letter-spacing: 0.04em;
        }

        .advanced {
          border-top: 1px solid var(--border);
          padding: 8px 0 0;
          margin-top: 4px;
        }
        .advanced > summary {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 12px 0;
          cursor: pointer;
          list-style: none;
          user-select: none;
        }
        .advanced > summary::-webkit-details-marker { display: none; }
        .advanced > summary::before {
          content: '›';
          display: inline-block;
          width: 14px;
          color: var(--text-faint);
          transition: transform 0.15s ease;
        }
        .advanced[open] > summary::before { transform: rotate(90deg); }
        .advanced-body { padding-bottom: 8px; }
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

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="slider-wrap">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="slider-bounds">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      <style jsx>{`
        .slider-wrap {
          display: flex; flex-direction: column; gap: 2px;
          min-width: 200px;
        }
        input[type='range'] {
          appearance: none;
          width: 100%;
          height: 4px;
          background: rgba(232, 220, 196, 0.12);
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }
        input[type='range']:disabled { opacity: 0.4; cursor: not-allowed; }
        input[type='range']::-webkit-slider-thumb {
          appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: var(--accent);
          cursor: inherit;
          border: 0;
        }
        .slider-bounds {
          display: flex; justify-content: space-between;
          font-family: var(--mono);
          font-size: 10px;
          color: var(--text-faint);
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}

function MaxMpSelect({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const options: Array<{ label: string; value: number | null }> = [
    { label: '12 MP', value: 12 },
    { label: '24 MP', value: 24 },
    { label: '50 MP', value: 50 },
    { label: '100 MP', value: 100 },
    { label: 'No cap', value: null },
  ];
  return (
    <div className="mp-options">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`mp-opt ${selected ? 'selected' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
      <style jsx>{`
        .mp-options {
          display: flex; gap: 4px; flex-wrap: wrap;
          min-width: 200px;
          justify-content: flex-end;
        }
        .mp-opt {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.04em;
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: border-color 0.15s ease, color 0.15s ease;
        }
        .mp-opt:hover:not(:disabled) { border-color: var(--border-strong); }
        .mp-opt.selected {
          border-color: var(--accent);
          color: var(--accent);
        }
        .mp-opt:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
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
