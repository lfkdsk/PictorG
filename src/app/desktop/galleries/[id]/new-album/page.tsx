'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import yaml from 'js-yaml';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type BatchFile,
  type LocalGallery,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { useCompressIpc } from '@/components/desktop/useCompressIpc';
import { fireUndoToast } from '@/components/desktop/UndoToast';

const README_PATH = 'README.yml';

type FormState = {
  name: string;
  url: string;
  date: string;
  style: 'fullscreen' | 'default';
  location: string; // "lat, lng"
};

const initialForm: FormState = {
  name: '',
  url: '',
  date: new Date().toISOString().split('T')[0],
  style: 'fullscreen',
  location: '',
};

type PhotoStatus = 'pending' | 'compressing' | 'ready' | 'error';

type Photo = {
  id: string;
  original: File;
  preview: string;       // object URL for the original (lightweight, for grid)
  compressed?: File;     // squoosh output
  status: PhotoStatus;
  error?: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function parseLocation(raw: string): [number, number] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1]];
}

function isImageFile(file: File): boolean {
  return /^image\//.test(file.type) ||
    /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i.test(file.name);
}

export default function NewAlbumPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const galleryId = params?.id;

  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);

  const [form, setForm] = useState<FormState>(initialForm);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'committing' | 'done'>('form');

  // Compression queue: serial, one file at a time, won't restart in-flight items.
  const inFlightRef = useRef<Set<string>>(new Set());
  const { compress } = useCompressIpc();

  useEffect(() => {
    setBridge(getPicgBridge());
  }, []);

  useEffect(() => {
    if (!bridge || !galleryId) return;
    bridge.gallery.resolve(galleryId).then((g) => {
      setGallery(g);
      if (g) {
        setAdapter(
          new PreloadBridgeAdapter({ repoPath: g.localPath, bridge: bridge.storage })
        );
      }
    });
  }, [bridge, galleryId]);

  // Compress next pending photo whenever the queue changes.
  useEffect(() => {
    const next = photos.find(
      (p) => p.status === 'pending' && !inFlightRef.current.has(p.id)
    );
    if (!next) return;

    inFlightRef.current.add(next.id);
    setPhotos((prev) =>
      prev.map((p) => (p.id === next.id ? { ...p, status: 'compressing' } : p))
    );

    compress(next.original)
      .then((compressed) => {
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === next.id ? { ...p, compressed, status: 'ready' } : p
          )
        );
      })
      .catch((err) => {
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === next.id
              ? { ...p, status: 'error', error: err instanceof Error ? err.message : String(err) }
              : p
          )
        );
      })
      .finally(() => {
        inFlightRef.current.delete(next.id);
      });
  }, [photos, compress]);

  // Free object URLs on unmount.
  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter(isImageFile);
    if (incoming.length === 0) return;
    const items: Photo[] = incoming.map((file) => ({
      id: crypto.randomUUID(),
      original: file,
      preview: URL.createObjectURL(file),
      status: 'pending',
    }));
    setPhotos((prev) => [...prev, ...items]);
    setCoverId((cur) => cur ?? items[0].id);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.preview);
      return prev.filter((p) => p.id !== id);
    });
    setCoverId((cur) => (cur === id ? null : cur));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  const ready = photos.length > 0 && photos.every((p) => p.status === 'ready');
  const compressing = photos.some((p) => p.status === 'compressing' || p.status === 'pending');
  const errored = photos.some((p) => p.status === 'error');

  const totalOriginal = useMemo(
    () => photos.reduce((s, p) => s + p.original.size, 0),
    [photos]
  );
  const totalCompressed = useMemo(
    () => photos.reduce((s, p) => s + (p.compressed?.size ?? 0), 0),
    [photos]
  );
  const savings =
    totalOriginal > 0 && totalCompressed > 0
      ? 1 - totalCompressed / totalOriginal
      : 0;

  function validateForm(): string | null {
    if (!form.name.trim()) return 'Album name is required.';
    if (!form.url.trim()) return 'URL slug is required.';
    if (form.url.includes('/')) return 'URL slug cannot contain "/".';
    if (form.location && parseLocation(form.location) === null) {
      return 'Location must be "lat, lng" with two numbers.';
    }
    if (photos.length === 0) return 'Add at least one photo.';
    if (!ready) return 'Photos still compressing — wait for all to finish.';
    if (errored) return 'One or more photos failed to compress. Remove them and retry.';
    if (!coverId) return 'Pick a cover photo.';
    return null;
  }

  async function handleSubmit() {
    const err = validateForm();
    if (err) {
      setSubmitError(err);
      return;
    }
    if (!adapter || !gallery) return;

    setSubmitting(true);
    setSubmitError(null);
    setPhase('committing');

    try {
      // Read existing README.yml (may be absent on a fresh repo).
      let existing: Record<string, any> = {};
      const meta = await adapter.readFileMetadata(README_PATH);
      if (meta) {
        const file = await adapter.readFile(README_PATH);
        const parsed = yaml.load(file.text(), {
          schema: yaml.CORE_SCHEMA,
          json: true,
        }) as Record<string, any> | null;
        if (parsed && typeof parsed === 'object') existing = parsed;
      }

      // Refuse to clobber an existing album that uses the same url slug.
      for (const [k, v] of Object.entries(existing)) {
        if (v?.url === form.url) {
          throw new Error(`URL slug "${form.url}" is already used by album "${k}".`);
        }
      }

      const cover = photos.find((p) => p.id === coverId);
      if (!cover?.compressed) {
        throw new Error('Cover photo is missing compressed bytes.');
      }
      const coverFilename = cover.compressed.name;

      // Build the BatchFile[] payload: every compressed photo + the new README.
      const fileEntries: BatchFile[] = [];
      for (const p of photos) {
        if (!p.compressed) continue;
        const bytes = new Uint8Array(await p.compressed.arrayBuffer());
        fileEntries.push({
          path: `${form.url}/${p.compressed.name}`,
          content: bytes,
        });
      }

      const newAlbumEntry: Record<string, any> = {
        url: form.url,
        date: form.date,
        style: form.style,
        cover: `${form.url}/${coverFilename}`,
      };
      const loc = parseLocation(form.location);
      if (loc) newAlbumEntry.location = loc;

      // New album first to mirror the web flow, which prepends the new entry.
      const merged = { [form.name.trim()]: newAlbumEntry, ...existing };
      const yamlText = yaml.dump(merged, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false,
      });

      fileEntries.push({ path: README_PATH, content: yamlText });

      await adapter.batchWriteFiles(
        fileEntries,
        `Add new album: ${form.name.trim()}`
      );
      fireUndoToast({
        galleryId: gallery.id,
        message: `Created album: ${form.name.trim()}`,
      });

      setPhase('done');
      // Hard nav: see the same comment in the album-delete handler.
      // Jumping cross-route in Next 14 dev sometimes hits a stale webpack
      // runtime; full page reload sidesteps it.
      const href = `/desktop/galleries/${encodeURIComponent(gallery.id)}?t=${Date.now()}`;
      if (typeof window !== 'undefined') {
        window.location.assign(href);
      } else {
        router.push(href as any);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setPhase('form');
    } finally {
      setSubmitting(false);
    }
  }

  if (!bridge) {
    return (
      <div className="page">
        <main className="empty"><h1>Desktop only</h1></main>
        <DesktopTheme />
      </div>
    );
  }
  if (!gallery) {
    return (
      <div className="page">
        <Topbar />
        <main className="loading"><p>Loading…</p></main>
        <DesktopTheme />
        <style jsx>{`
          .loading { padding: 96px; text-align: center; color: var(--text-muted);
                     font-family: var(--mono); font-size: 13px;
                     letter-spacing: 0.05em; text-transform: uppercase; }
        `}</style>
      </div>
    );
  }

  const galleryHref = `/desktop/galleries/${encodeURIComponent(gallery.id)}`;

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href={galleryHref as any} className="picg-back-link">
          ← {gallery.fullName}
        </Link>

        <section className="hero">
          <h1>New album</h1>
          <p className="meta">in {gallery.fullName}</p>
        </section>

        <section className="block">
          <h2>Details</h2>
          <div className="form">
            <label className="field">
              <span>Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Crater Lake"
                disabled={submitting}
              />
            </label>
            <div className="row">
              <label className="field">
                <span>URL slug</span>
                <input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="CraterLake"
                  disabled={submitting}
                />
              </label>
              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  disabled={submitting}
                />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>Style</span>
                <select
                  value={form.style}
                  onChange={(e) =>
                    setForm({ ...form, style: e.target.value as FormState['style'] })
                  }
                  disabled={submitting}
                >
                  <option value="fullscreen">Fullscreen</option>
                  <option value="default">Default</option>
                </select>
              </label>
              <label className="field">
                <span>Location</span>
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="37.4159, -118.7717"
                  disabled={submitting}
                />
              </label>
            </div>
          </div>
        </section>

        <section className="block">
          <h2>
            Photos
            {photos.length > 0 && (
              <span className="size-summary">
                {photos.filter((p) => p.status === 'ready').length}/{photos.length} compressed · {formatBytes(totalOriginal)}
                {totalCompressed > 0 && (
                  <>
                    {' → '}
                    {formatBytes(totalCompressed)}{' '}
                    <span className="savings">
                      ({(savings * 100).toFixed(0)}% smaller)
                    </span>
                  </>
                )}
              </span>
            )}
          </h2>

          {photos.length > 0 && (
            <div className="picg-progress-bar">
              <div
                className="picg-progress-fill"
                style={{
                  width: `${(photos.filter((p) => p.status === 'ready').length / photos.length) * 100}%`,
                }}
              />
            </div>
          )}

          <DropZone
            dragOver={dragOver}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onSelect={addFiles}
            disabled={submitting}
          />

          {photos.length > 0 && (
            <ul className="photos">
              {photos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`picg-thumb ${coverId === p.id ? 'is-cover' : ''}`}
                    onClick={() => setCoverId(p.id)}
                    aria-label={`Set ${p.original.name} as cover`}
                    disabled={submitting}
                  >
                    <img src={p.preview} alt="" />
                    {coverId === p.id && <span className="cover-badge">Cover</span>}
                    {p.status === 'pending' && <span className="state pending">queued</span>}
                    {p.status === 'compressing' && <span className="state compressing">compressing…</span>}
                    {p.status === 'error' && <span className="state errored">{p.error ?? 'error'}</span>}
                    {p.status === 'ready' && p.compressed && (
                      <span className="state ready">
                        {formatBytes(p.original.size)} → {formatBytes(p.compressed.size)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="remove"
                    onClick={() => removePhoto(p.id)}
                    disabled={submitting}
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {submitError && (
          <div className="banner">{submitError}</div>
        )}

        <div className="actions-row">
          <Link href={galleryHref as any} className="btn ghost">
            Cancel
          </Link>
          <button
            type="button"
            className="btn primary"
            onClick={handleSubmit}
            disabled={submitting || !ready || !coverId}
          >
            {phase === 'committing' ? 'Committing…' : 'Create album'}
          </button>
          {compressing && !submitting && (
            <span className="hint">Waiting on compression…</span>
          )}
        </div>
      </main>

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 960px; margin: 0 auto; }

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

        .block { margin-bottom: 32px; }
        .block h2 {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 500;
          margin: 0 0 14px;
          display: flex; gap: 12px; align-items: baseline;
        }
        .size-summary {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-faint);
          letter-spacing: 0.04em;
          text-transform: none;
        }
        .savings { color: var(--accent); }

        .form { display: flex; flex-direction: column; gap: 14px; }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field span {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .field input, .field select {
          padding: 10px 12px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: inherit;
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .field input:focus, .field select:focus { border-color: var(--accent); }
        .field input::placeholder { color: var(--text-faint); }
        .field input:disabled, .field select:disabled { opacity: 0.6; }

        .photos {
          list-style: none; margin: 16px 0 0; padding: 0;
          display: grid; gap: 8px;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        }
        .photos li { position: relative; }
        .photos .remove {
          position: absolute; top: 6px; right: 6px;
          width: 24px; height: 24px;
          border-radius: 50%;
          background: rgba(20, 18, 14, 0.85);
          color: var(--text);
          border: 0;
          font-size: 12px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .photos li:hover .remove { opacity: 1; }
        .photos .remove:hover { background: rgba(216, 90, 70, 0.7); }

        .state {
          position: absolute; left: 6px; bottom: 6px; right: 6px;
          padding: 4px 8px;
          background: rgba(20, 18, 14, 0.85);
          backdrop-filter: blur(4px);
          border-radius: 6px;
          color: var(--text);
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: 0.04em;
          text-align: center;
          line-height: 1.4;
        }
        .state.compressing { color: var(--accent); }
        .state.errored { color: #f0857b; }

        .cover-badge {
          position: absolute; top: 6px; left: 6px;
          padding: 2px 8px;
          background: var(--accent);
          color: var(--accent-text);
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          border-radius: 999px;
          font-weight: 600;
        }

        .banner {
          background: rgba(216, 90, 70, 0.12);
          border: 1px solid rgba(216, 90, 70, 0.32);
          color: #f0bfb6;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 13px;
          font-family: var(--mono);
        }

        .actions-row {
          display: flex; gap: 12px; align-items: center;
          margin-top: 24px;
        }
        .hint {
          color: var(--text-muted);
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}

function DropZone({
  dragOver,
  disabled,
  onDragOver,
  onDragLeave,
  onDrop,
  onSelect,
}: {
  dragOver: boolean;
  disabled: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onSelect: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop ${dragOver ? 'over' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onSelect(e.target.files);
          e.target.value = '';
        }}
        disabled={disabled}
      />
      <p className="big">Drop photos here</p>
      <p className="small">or click to browse — JPG/PNG/WebP, compressed to WebP locally</p>
      <style jsx>{`
        .drop {
          padding: 32px 24px;
          border: 1px dashed var(--border-strong);
          border-radius: 14px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
          background: var(--bg-card);
        }
        .drop:hover { border-color: var(--accent); }
        .drop.over { border-color: var(--accent); background: var(--bg-card-hover); }
        .drop.disabled { opacity: 0.6; cursor: not-allowed; }
        .big {
          margin: 0 0 6px;
          font-family: var(--serif);
          font-size: 22px;
          color: var(--text);
        }
        .small {
          margin: 0;
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
