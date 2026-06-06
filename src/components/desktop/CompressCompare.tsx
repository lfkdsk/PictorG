'use client';

// Before/after comparison lightbox used in the add-photos flow. Lets the
// user eyeball the original vs the compressed encode and pick, per photo,
// which one actually gets uploaded.
//
// Why this exists: "lossless" WebP (and even lossy WebP on already-small
// sources) can come out LARGER than the original JPEG/HEIC — re-encoding a
// lossy source to preserve every pixel is inherently expensive. Rather than
// silently shipping a bigger file, we surface both and let the user choose.
// The default choice (decided by the caller) is "whichever is smaller", so
// doing nothing already never inflates a photo.
//
// Generic over a minimal item shape so the same component can serve the
// add-to-album page, the new-album page, and (later) the web upload pages.

import { useCallback, useEffect } from 'react';

export type ComparePhoto = {
  id: string;
  /** Display name of the photo (the original filename is fine). */
  name: string;
  /**
   * Displayable URL for the ORIGINAL. For JPEG/PNG/WebP this can be a full
   * object URL; for HEIC the browser can't decode it, so the caller may pass
   * a generated preview (or an empty string, which renders a placeholder).
   */
  beforeUrl: string;
  /** Object URL for the COMPRESSED encode (always a WebP/JPEG we can show). */
  afterUrl: string;
  /** Byte size of the original file. */
  originalSize: number;
  /** Byte size of the compressed encode. */
  compressedSize: number;
  /** Current choice: true = upload the original, false = upload the compressed. */
  useOriginal: boolean;
};

export function formatBytes(n?: number): string {
  if (!n || n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Signed size delta of compressed vs original, as a label + sign.
 * Positive (red) means the compressed encode is LARGER than the source.
 */
export function sizeDelta(originalSize: number, compressedSize: number): {
  pct: number;
  label: string;
  bigger: boolean;
} {
  if (!originalSize) return { pct: 0, label: '—', bigger: false };
  const ratio = (compressedSize - originalSize) / originalSize;
  const pct = Math.round(ratio * 100);
  const bigger = compressedSize > originalSize;
  const label = pct === 0 ? '±0%' : pct > 0 ? `+${pct}% larger` : `${pct}% smaller`;
  return { pct, label, bigger };
}

export function CompressCompareModal({
  photos,
  index,
  onIndex,
  onClose,
  onToggle,
}: {
  photos: ComparePhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onToggle: (id: string) => void;
}) {
  const total = photos.length;
  const photo = photos[index];

  const go = useCallback(
    (delta: number) => {
      if (total === 0) return;
      const next = (index + delta + total) % total;
      onIndex(next);
    },
    [index, total, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (photo) onToggle(photo.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, onToggle, photo]);

  if (!photo) return null;

  const delta = sizeDelta(photo.originalSize, photo.compressedSize);

  return (
    <div className="cc-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cc-shell" onClick={(e) => e.stopPropagation()}>
        <header className="cc-head">
          <div className="cc-title" title={photo.name}>
            {photo.name}
          </div>
          <div className="cc-count">
            {index + 1} / {total}
          </div>
          <button type="button" className="cc-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="cc-body">
          {total > 1 && (
            <button
              type="button"
              className="cc-nav cc-prev"
              aria-label="Previous photo"
              onClick={() => go(-1)}
            >
              ‹
            </button>
          )}

          <div className="cc-panes">
            <figure className={`cc-pane ${photo.useOriginal ? 'is-chosen' : ''}`}>
              <div className="cc-img-wrap">
                <ImageOrPlaceholder src={photo.beforeUrl} alt="original" />
                {photo.useOriginal && <span className="cc-chosen-tag">Using this</span>}
              </div>
              <figcaption>
                <span className="cc-kind">Original</span>
                <span className="cc-size">{formatBytes(photo.originalSize)}</span>
              </figcaption>
            </figure>

            <div className="cc-mid">
              <span className={`cc-delta ${delta.bigger ? 'is-bigger' : 'is-smaller'}`}>
                {delta.label}
              </span>
            </div>

            <figure className={`cc-pane ${!photo.useOriginal ? 'is-chosen' : ''}`}>
              <div className="cc-img-wrap">
                <ImageOrPlaceholder src={photo.afterUrl} alt="compressed" />
                {!photo.useOriginal && <span className="cc-chosen-tag">Using this</span>}
              </div>
              <figcaption>
                <span className="cc-kind">Compressed</span>
                <span className="cc-size">{formatBytes(photo.compressedSize)}</span>
              </figcaption>
            </figure>
          </div>

          {total > 1 && (
            <button
              type="button"
              className="cc-nav cc-next"
              aria-label="Next photo"
              onClick={() => go(1)}
            >
              ›
            </button>
          )}
        </div>

        <footer className="cc-foot">
          {delta.bigger && (
            <p className="cc-warn">
              The compressed encode is larger than the original — keep the
              original to avoid inflating this photo.
            </p>
          )}
          <div className="cc-toggle" role="group" aria-label="Which file to upload">
            <button
              type="button"
              className={`cc-seg ${!photo.useOriginal ? 'active' : ''}`}
              onClick={() => {
                if (photo.useOriginal) onToggle(photo.id);
              }}
            >
              Use compressed
            </button>
            <button
              type="button"
              className={`cc-seg ${photo.useOriginal ? 'active' : ''}`}
              onClick={() => {
                if (!photo.useOriginal) onToggle(photo.id);
              }}
            >
              Use original
            </button>
          </div>
        </footer>
      </div>

      <style jsx>{`
        .cc-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.78);
          backdrop-filter: blur(3px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
        }
        .cc-shell {
          display: flex;
          flex-direction: column;
          width: min(1100px, 100%);
          max-height: 100%;
          background: var(--bg-card, #1b1b1b);
          border: 1px solid var(--border, #333);
          border-radius: 14px;
          overflow: hidden;
        }
        .cc-head {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--border, #333);
        }
        .cc-title {
          flex: 1;
          min-width: 0;
          font-family: var(--mono, monospace);
          font-size: 13px;
          color: var(--text, #eee);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cc-count {
          font-family: var(--mono, monospace);
          font-size: 12px;
          color: var(--text-muted, #999);
          letter-spacing: 0.04em;
        }
        .cc-x {
          border: none;
          background: transparent;
          color: var(--text-muted, #999);
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          padding: 0 4px;
        }
        .cc-x:hover {
          color: var(--text, #eee);
        }

        .cc-body {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 18px;
          min-height: 0;
          flex: 1;
        }
        .cc-panes {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 14px;
          align-items: center;
          min-width: 0;
        }
        .cc-pane {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
          padding: 8px;
          border: 1px solid transparent;
          border-radius: 10px;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .cc-pane.is-chosen {
          border-color: var(--accent, #d8a657);
          background: rgba(255, 255, 255, 0.03);
        }
        .cc-img-wrap {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.35);
          border-radius: 8px;
          overflow: hidden;
          aspect-ratio: 4 / 3;
        }
        .cc-img-wrap :global(img) {
          max-width: 100%;
          max-height: 52vh;
          object-fit: contain;
          display: block;
        }
        .cc-chosen-tag {
          position: absolute;
          top: 8px;
          left: 8px;
          font-family: var(--mono, monospace);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 5px;
          background: var(--accent, #d8a657);
          color: #1a1a1a;
        }
        figcaption {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          font-family: var(--mono, monospace);
        }
        .cc-kind {
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted, #999);
        }
        .cc-size {
          font-size: 13px;
          color: var(--text, #eee);
        }
        .cc-mid {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 2px;
        }
        .cc-delta {
          font-family: var(--mono, monospace);
          font-size: 11px;
          letter-spacing: 0.03em;
          text-align: center;
          padding: 4px 8px;
          border-radius: 6px;
          white-space: nowrap;
        }
        .cc-delta.is-smaller {
          color: #7bb37b;
          background: rgba(123, 179, 123, 0.12);
        }
        .cc-delta.is-bigger {
          color: #e0897e;
          background: rgba(216, 90, 70, 0.14);
        }

        .cc-nav {
          flex-shrink: 0;
          border: 1px solid var(--border, #333);
          background: transparent;
          color: var(--text, #eee);
          width: 36px;
          height: 56px;
          border-radius: 8px;
          font-size: 24px;
          line-height: 1;
          cursor: pointer;
        }
        .cc-nav:hover {
          border-color: var(--accent, #d8a657);
          color: var(--accent, #d8a657);
        }

        .cc-foot {
          padding: 14px 18px 18px;
          border-top: 1px solid var(--border, #333);
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: center;
        }
        .cc-warn {
          margin: 0;
          font-size: 12px;
          color: #e0897e;
          text-align: center;
        }
        .cc-toggle {
          display: inline-flex;
          border: 1px solid var(--border, #333);
          border-radius: 8px;
          overflow: hidden;
        }
        .cc-seg {
          border: none;
          background: transparent;
          color: var(--text-muted, #999);
          font-family: var(--mono, monospace);
          font-size: 12px;
          letter-spacing: 0.03em;
          padding: 9px 18px;
          cursor: pointer;
        }
        .cc-seg + .cc-seg {
          border-left: 1px solid var(--border, #333);
        }
        .cc-seg.active {
          background: var(--accent, #d8a657);
          color: #1a1a1a;
        }
      `}</style>
    </div>
  );
}

// Small <img> wrapper that swaps in a placeholder when the source can't be
// decoded (the common case: a HEIC original the browser won't render).
function ImageOrPlaceholder({ src, alt }: { src: string; alt: string }) {
  if (!src) return <PreviewUnavailable />;
  return (
    <>
      <img
        src={src}
        alt={alt}
        onError={(e) => {
          const el = e.currentTarget;
          el.style.display = 'none';
          const sib = el.nextElementSibling as HTMLElement | null;
          if (sib) sib.style.display = 'flex';
        }}
      />
      {/* Revealed by the <img> onError above when the source can't be
          decoded — chiefly a HEIC original the browser won't render. */}
      <div style={{ display: 'none', width: '100%', height: '100%' }}>
        <PreviewUnavailable />
      </div>
    </>
  );
}

function PreviewUnavailable() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        fontFamily: 'var(--mono, monospace)',
        fontSize: 11,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--text-faint, #777)',
        textAlign: 'center',
        padding: 16,
      }}
    >
      preview unavailable
    </div>
  );
}
