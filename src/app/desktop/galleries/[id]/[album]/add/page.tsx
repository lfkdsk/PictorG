'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

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
import { makePreviewUrl } from '@/components/desktop/makePreview';
import { fireUndoToast } from '@/components/desktop/UndoToast';
import {
  CompressCompareModal,
  type ComparePhoto,
  sizeDelta,
} from '@/components/desktop/CompressCompare';

type PhotoStatus = 'pending' | 'compressing' | 'ready' | 'error';

type Photo = {
  id: string;
  original: File;
  preview: string;       // 480px downsampled thumbnail — grid only
  originalUrl: string;   // full-res object URL of the original — compare modal
  compressed?: File;
  compressedUrl?: string;
  useOriginal?: boolean;
  status: PhotoStatus;
  error?: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function isImageFile(file: File): boolean {
  // Live Photos arrive as HEIC + matching MOV with the same basename.
  // We accept the MOV here so users can drop the pair together; the
  // compressor passes MOV through untouched (video, no sharp work)
  // and git ends up with both files side by side, which is the
  // convention web viewers look for to recognize a Live Photo.
  return /^image\//.test(file.type) ||
    file.type === 'video/quicktime' ||
    /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|mov)$/i.test(file.name);
}

export default function AddPhotosPage() {
  const router = useRouter();
  const params = useParams<{ id: string; album: string }>();
  const galleryId = params?.id;
  const albumUrl = useMemo(() => {
    try {
      return params?.album ? decodeURIComponent(params.album) : null;
    } catch {
      return params?.album ?? null;
    }
  }, [params?.album]);

  const [bridge, setBridge] = useState<PicgBridge | null>(() => getPicgBridge());
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [compareIdx, setCompareIdx] = useState<number | null>(null);

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

  // Same serial compression queue as the create-album page; the worker hook
  // is per-page so opening this page warm-loads its own WASM instance once.
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
        // Re-encoding a lossy source losslessly (or even lossy WebP on an
        // already-small file) can come out LARGER than the original. Default
        // the per-photo choice to whichever file is smaller so doing nothing
        // never inflates a photo; the user can override in the compare modal.
        const compressedUrl = URL.createObjectURL(compressed);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === next.id
              ? {
                  ...p,
                  compressed,
                  compressedUrl,
                  useOriginal: compressed.size >= p.original.size,
                  status: 'ready',
                }
              : p
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

  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        URL.revokeObjectURL(p.preview);
        if (p.originalUrl) URL.revokeObjectURL(p.originalUrl);
        if (p.compressedUrl) URL.revokeObjectURL(p.compressedUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter(isImageFile);
    if (incoming.length === 0) return;
    // Add cards immediately with empty preview, fill each in the
    // background with a downsampled blob (createImageBitmap →
    // OffscreenCanvas → webp). Avoids the browser decoding 30 MB
    // originals just to render 200 px thumbnails.
    const items: Photo[] = incoming.map((file) => ({
      id: crypto.randomUUID(),
      original: file,
      preview: '',
      // Full-res URL straight off the original File — no decode/copy here,
      // the browser only decodes it when the compare modal shows this photo.
      // The grid keeps using the cheap 480px `preview` thumbnail.
      originalUrl: URL.createObjectURL(file),
      status: 'pending',
    }));
    setPhotos((prev) => [...prev, ...items]);
    items.forEach((item) => {
      makePreviewUrl(item.original).then((url) => {
        setPhotos((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, preview: url } : p))
        );
      });
    });
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === id);
      if (photo) {
        URL.revokeObjectURL(photo.preview);
        if (photo.originalUrl) URL.revokeObjectURL(photo.originalUrl);
        if (photo.compressedUrl) URL.revokeObjectURL(photo.compressedUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
  }

  // Flip the per-photo upload choice (compressed vs original).
  function toggleUseOriginal(id: string) {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, useOriginal: !p.useOriginal } : p))
    );
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  const ready = photos.length > 0 && photos.every((p) => p.status === 'ready');
  const compressing = photos.some(
    (p) => p.status === 'compressing' || p.status === 'pending'
  );
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

  // Items the compare modal can step through: only photos whose compress
  // has landed, in grid order. The modal indexes into this list, so the
  // thumbnail click resolves its position by id below.
  const comparePhotos = useMemo<ComparePhoto[]>(
    () =>
      photos
        .filter((p) => p.status === 'ready' && p.compressed)
        .map((p) => ({
          id: p.id,
          name: p.original.name,
          beforeUrl: p.originalUrl || p.preview,
          afterUrl: p.compressedUrl ?? '',
          originalSize: p.original.size,
          compressedSize: p.compressed!.size,
          useOriginal: !!p.useOriginal,
        })),
    [photos]
  );

  async function handleSubmit() {
    if (!adapter || !gallery || !albumUrl) return;
    if (!ready) {
      setSubmitError('Photos still compressing — wait for all to finish.');
      return;
    }
    if (errored) {
      setSubmitError('One or more photos failed to compress. Remove them and retry.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      // Block silent overwrites: refuse if any compressed filename collides
      // with something already in the album dir.
      const existing = await adapter.listDirectory(albumUrl);
      const existingNames = new Set(existing.map((e) => e.name));
      const duplicates: string[] = [];

      const fileEntries: BatchFile[] = [];
      for (const p of photos) {
        // Upload the variant the user chose. Default (set at compress time)
        // is whichever is smaller, so the original wins when the WebP encode
        // came out larger. Using the original keeps its source extension.
        const chosen = p.useOriginal ? p.original : p.compressed;
        if (!chosen) continue;
        const chosenName = p.useOriginal ? p.original.name : p.compressed!.name;
        if (existingNames.has(chosenName)) {
          duplicates.push(chosenName);
          continue;
        }
        const bytes = new Uint8Array(await chosen.arrayBuffer());
        fileEntries.push({
          path: `${albumUrl}/${chosenName}`,
          content: bytes,
        });
      }

      if (duplicates.length > 0) {
        throw new Error(
          `${duplicates.length} file${duplicates.length === 1 ? '' : 's'} already exist in this album: ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? '…' : ''}. Remove or rename and retry.`
        );
      }

      await adapter.batchWriteFiles(
        fileEntries,
        `Add ${fileEntries.length} photo${fileEntries.length === 1 ? '' : 's'} to ${albumUrl}`
      );
      fireUndoToast({
        galleryId: gallery.id,
        message: `Added ${fileEntries.length} photo${fileEntries.length === 1 ? '' : 's'} to ${albumUrl}`,
      });

      const albumHref = `/desktop/galleries/${encodeURIComponent(gallery.id)}/${encodeURIComponent(albumUrl)}?t=${Date.now()}`;
      router.push(albumHref as any);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
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
  if (!gallery || !albumUrl) {
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

  const albumHref = `/desktop/galleries/${encodeURIComponent(gallery.id)}/${encodeURIComponent(albumUrl)}`;

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href={albumHref as any} className="picg-back-link">
          ← {albumUrl}
        </Link>

        <section className="hero">
          <h1>Add photos</h1>
          <p className="meta">to {albumUrl} in {gallery.fullName}</p>
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
              {photos.map((p) => {
                const ready = p.status === 'ready' && p.compressed;
                const delta = ready
                  ? sizeDelta(p.original.size, p.compressed!.size)
                  : null;
                const openCompare = () => {
                  const i = comparePhotos.findIndex((c) => c.id === p.id);
                  if (i >= 0) setCompareIdx(i);
                };
                return (
                  <li key={p.id}>
                    <div
                      className={`picg-thumb ${ready ? 'is-clickable' : ''}`}
                      onClick={ready ? openCompare : undefined}
                      role={ready ? 'button' : undefined}
                      tabIndex={ready ? 0 : undefined}
                      onKeyDown={
                        ready
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openCompare();
                              }
                            }
                          : undefined
                      }
                      aria-label={ready ? `Compare ${p.original.name}` : undefined}
                    >
                      <img src={p.preview} alt="" className="photo-preview" />
                      {p.status === 'pending' && <span className="state pending">queued</span>}
                      {p.status === 'compressing' && <span className="state compressing">compressing…</span>}
                      {p.status === 'error' && <span className="state errored">{p.error ?? 'error'}</span>}
                      {ready && delta && (
                        <span className={`state ready ${delta.bigger ? 'is-bigger' : ''}`}>
                          {formatBytes(p.original.size)} → {formatBytes(p.compressed!.size)}
                          {' · '}
                          {delta.label}
                        </span>
                      )}
                    </div>
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
                );
              })}
            </ul>
          )}
        </section>

        {submitError && (
          <div className="picg-banner">{submitError}</div>
        )}

        <div className="actions-row">
          <Link href={albumHref as any} className="btn ghost">
            Cancel
          </Link>
          <button
            type="button"
            className="btn primary"
            onClick={handleSubmit}
            disabled={submitting || !ready}
          >
            {submitting ? 'Uploading…' : `Upload ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          </button>
          {compressing && !submitting && (
            <span className="hint">Waiting on compression…</span>
          )}
        </div>
      </main>

      {compareIdx != null && (
        <CompressCompareModal
          photos={comparePhotos}
          index={compareIdx}
          onIndex={setCompareIdx}
          onClose={() => setCompareIdx(null)}
          onToggle={toggleUseOriginal}
        />
      )}

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
        .state.ready.is-bigger { color: #f0857b; }

        .picg-thumb.is-clickable { cursor: zoom-in; }

        .photo-preview {
          object-fit: contain;
          background: var(--bg);
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
        accept="image/*,.heic,.heif,.mov"
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
