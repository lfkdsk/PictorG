'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import yaml from 'js-yaml';

import {
  PreloadBridgeAdapter,
  getPicgBridge,
  type DirectoryEntry,
  type LocalGallery,
  type PicgBridge,
  type StorageAdapter,
} from '@/core/storage';
import { Topbar, DesktopTheme } from '@/components/DesktopChrome';
import { useAdapterImage } from '@/components/desktop/useAdapterImage';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'];

type AlbumMeta = {
  name: string;
  url: string;
  date?: string;
  style?: string;
  cover?: string;
  location?: [number, number];
};

type EditForm = {
  name: string;
  url: string;
  date: string;
  style: string;
  cover: string;
  location: string; // "lat, lng" — same shape as the create-album form
};

function isImage(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function findAlbum(yamlText: string, url: string): AlbumMeta | null {
  const data = yaml.load(yamlText, {
    schema: yaml.CORE_SCHEMA,
    json: true,
  }) as Record<string, Record<string, unknown>> | null;
  if (!data) return null;
  for (const [name, fields] of Object.entries(data)) {
    if (fields?.url === url) {
      const loc = Array.isArray(fields.location) && fields.location.length === 2
        ? ([Number(fields.location[0]), Number(fields.location[1])] as [number, number])
        : undefined;
      return {
        name: name.trim(),
        url: String(fields.url),
        date:
          typeof fields.date === 'string'
            ? fields.date
            : fields.date != null
              ? String(fields.date)
              : undefined,
        style: typeof fields.style === 'string' ? fields.style : undefined,
        cover: typeof fields.cover === 'string' ? fields.cover : undefined,
        location: loc && !Number.isNaN(loc[0]) && !Number.isNaN(loc[1]) ? loc : undefined,
      };
    }
  }
  return null;
}

function toEditForm(meta: AlbumMeta): EditForm {
  return {
    name: meta.name,
    url: meta.url,
    date: meta.date ?? '',
    style: meta.style ?? 'fullscreen',
    cover: meta.cover ?? '',
    location: meta.location ? `${meta.location[0]}, ${meta.location[1]}` : '',
  };
}

function parseLocation(raw: string): [number, number] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1]];
}

export default function AlbumPage() {
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

  const [bridge, setBridge] = useState<PicgBridge | null>(null);
  const [gallery, setGallery] = useState<LocalGallery | null>(null);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [albumMeta, setAlbumMeta] = useState<AlbumMeta | null>(null);
  const [images, setImages] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editPhase, setEditPhase] = useState<'form' | 'pickCover'>('form');
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!adapter || !albumUrl) return;
    let cancelled = false;
    (async () => {
      try {
        // README.yml may be missing on a freshly-cloned non-PicG repo;
        // fall through to listing the directory anyway.
        try {
          const readme = await adapter.readFile('README.yml');
          if (!cancelled) setAlbumMeta(findAlbum(readme.text(), albumUrl));
        } catch {
          /* ignore */
        }

        const entries = await adapter.listDirectory(albumUrl);
        if (cancelled) return;
        setImages(entries.filter((e) => e.type === 'file' && isImage(e.name)));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, albumUrl]);

  // Close lightbox on Escape, navigate with arrow keys.
  useEffect(() => {
    if (!lightboxPath || !images) return;
    const idx = images.findIndex((img) => `${albumUrl}/${img.name}` === lightboxPath);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxPath(null);
      if (e.key === 'ArrowRight' && idx >= 0 && idx < images.length - 1) {
        setLightboxPath(`${albumUrl}/${images[idx + 1].name}`);
      }
      if (e.key === 'ArrowLeft' && idx > 0) {
        setLightboxPath(`${albumUrl}/${images[idx - 1].name}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxPath, images, albumUrl]);

  function openEdit() {
    if (!albumMeta) return;
    setEditForm(toEditForm(albumMeta));
    setEditError(null);
    setEditPhase('form');
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditError(null);
  }

  async function saveEdit() {
    if (!adapter || !editForm || !albumMeta || !gallery) return;

    const trimmedName = editForm.name.trim();
    const trimmedUrl = editForm.url.trim();
    if (!trimmedName) return setEditError('Name is required.');
    if (!trimmedUrl) return setEditError('URL slug is required.');
    if (trimmedUrl.includes('/')) return setEditError('URL slug cannot contain "/".');
    if (!editForm.date) return setEditError('Date is required.');
    if (!editForm.cover.trim()) return setEditError('Cover path is required.');

    let location: [number, number] | undefined;
    if (editForm.location.trim()) {
      const parsed = parseLocation(editForm.location);
      if (!parsed) {
        return setEditError('Location must be "lat, lng" with two numbers.');
      }
      location = parsed;
    }

    setSaving(true);
    setEditError(null);
    try {
      const file = await adapter.readFile('README.yml');
      const data = (yaml.load(file.text(), {
        schema: yaml.CORE_SCHEMA,
        json: true,
      }) ?? {}) as Record<string, any>;

      // If the user renamed the album, drop the old YAML key.
      if (trimmedName !== albumMeta.name) {
        delete data[albumMeta.name];
        // And refuse to silently overwrite a different existing album with
        // the same new name.
        if (data[trimmedName]) {
          throw new Error(`Another album already uses the name "${trimmedName}".`);
        }
      }
      // Same guard for URL slug collisions.
      if (trimmedUrl !== albumMeta.url) {
        for (const [k, v] of Object.entries(data)) {
          if (k !== albumMeta.name && k !== trimmedName && v?.url === trimmedUrl) {
            throw new Error(`URL slug "${trimmedUrl}" is already used by album "${k}".`);
          }
        }
      }

      const entry: Record<string, unknown> = {
        url: trimmedUrl,
        date: editForm.date,
        style: editForm.style,
        cover: editForm.cover.trim(),
      };
      if (location) entry.location = location;
      data[trimmedName] = entry;

      const yamlText = yaml.dump(data, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });

      await adapter.writeFile(
        'README.yml',
        yamlText,
        `Update album: ${trimmedName}`
      );

      setAlbumMeta({
        name: trimmedName,
        url: trimmedUrl,
        date: editForm.date,
        style: editForm.style,
        cover: editForm.cover.trim(),
        location,
      });
      setEditOpen(false);

      // If the slug moved, the URL we're sitting on no longer matches the
      // YAML — redirect to the new one. Files on disk stay where they are
      // (renaming the directory is a separate, riskier op we don't do here).
      if (trimmedUrl !== albumMeta.url) {
        router.replace(
          `/desktop/galleries/${encodeURIComponent(gallery.id)}/${encodeURIComponent(trimmedUrl)}` as any
        );
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
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

  const galleryHref = `/desktop/galleries/${encodeURIComponent(gallery.id)}`;

  return (
    <div className="page">
      <Topbar />

      <main>
        <Link href={galleryHref as any} className="picg-back-link">
          ← {gallery.fullName}
        </Link>

        <section className="hero">
          <div className="hero-row">
            <div>
              <h1>{albumMeta?.name ?? albumUrl}</h1>
              <p className="meta">
                {albumMeta?.date && <><span>{formatDate(albumMeta.date)}</span><span className="dot">•</span></>}
                <span>
                  {images == null
                    ? 'loading…'
                    : `${images.length} image${images.length === 1 ? '' : 's'}`}
                </span>
                {albumMeta?.style && (
                  <>
                    <span className="dot">•</span>
                    <span>{albumMeta.style}</span>
                  </>
                )}
                {albumMeta?.location && (
                  <>
                    <span className="dot">•</span>
                    <span>{albumMeta.location[0].toFixed(4)}, {albumMeta.location[1].toFixed(4)}</span>
                  </>
                )}
              </p>
            </div>
            {albumMeta && (
              <button className="btn ghost" onClick={openEdit}>Edit</button>
            )}
          </div>
        </section>

        {loadError && (
          <div className="banner">{loadError}</div>
        )}

        {images && images.length === 0 && (
          <div className="empty-block">
            <p>No images in this album.</p>
          </div>
        )}

        {images && images.length > 0 && (
          <ul className="picg-thumbs">
            {images.map((img) => (
              <Thumb
                key={img.path}
                adapter={adapter}
                albumUrl={albumUrl}
                name={img.name}
                onOpen={() => setLightboxPath(`${albumUrl}/${img.name}`)}
              />
            ))}
          </ul>
        )}
      </main>

      {lightboxPath && (
        <Lightbox
          adapter={adapter}
          path={lightboxPath}
          onClose={() => setLightboxPath(null)}
        />
      )}

      {editOpen && editForm && albumMeta && (
        <div className="picg-modal-backdrop" onClick={() => !saving && closeEdit()}>
          <div className="picg-modal picg-modal-wide" onClick={(e) => e.stopPropagation()}>
            <header className="picg-modal-header">
              <div className="picg-modal-title-wrap">
                {editPhase === 'pickCover' && (
                  <button
                    className="btn ghost icon"
                    onClick={() => setEditPhase('form')}
                    aria-label="Back"
                  >
                    ←
                  </button>
                )}
                <h2>{editPhase === 'pickCover' ? 'Choose cover' : 'Edit album'}</h2>
              </div>
              <button className="btn ghost icon" onClick={closeEdit} disabled={saving}>✕</button>
            </header>

            {editPhase === 'form' ? (
              <>
                <div className="picg-fields">
                  <label className="picg-field">
                    <span>Name</span>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      disabled={saving}
                    />
                  </label>
                  <div className="picg-field-row">
                    <label className="picg-field">
                      <span>URL slug</span>
                      <input
                        value={editForm.url}
                        onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                        disabled={saving}
                      />
                    </label>
                    <label className="picg-field">
                      <span>Date</span>
                      <input
                        type="date"
                        value={editForm.date}
                        onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                        disabled={saving}
                      />
                    </label>
                  </div>
                  <div className="picg-field-row">
                    <label className="picg-field">
                      <span>Style</span>
                      <select
                        value={editForm.style}
                        onChange={(e) => setEditForm({ ...editForm, style: e.target.value })}
                        disabled={saving}
                      >
                        <option value="fullscreen">Fullscreen</option>
                        <option value="default">Default</option>
                      </select>
                    </label>
                    <label className="picg-field">
                      <span>Location</span>
                      <input
                        value={editForm.location}
                        onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                        placeholder="37.4159, -118.7717"
                        disabled={saving}
                      />
                    </label>
                  </div>
                  <div className="picg-field">
                    <span>Cover</span>
                    <CoverField
                      adapter={adapter}
                      cover={editForm.cover}
                      onPick={() => setEditPhase('pickCover')}
                      disabled={saving || !images || images.length === 0}
                    />
                  </div>
                  {editForm.url.trim() !== albumMeta.url && editForm.url.trim() && (
                    <div className="picg-warning">
                      Changing the URL slug leaves files in <code>{albumMeta.url}/</code> orphaned —
                      the directory is not renamed automatically.
                    </div>
                  )}
                  {editError && <div className="picg-banner">{editError}</div>}
                </div>
                <div className="picg-modal-actions">
                  <button className="btn ghost" onClick={closeEdit} disabled={saving}>
                    Cancel
                  </button>
                  <button className="btn primary" onClick={saveEdit} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            ) : (
              <CoverPicker
                adapter={adapter}
                albumUrl={albumUrl}
                images={images ?? []}
                currentCover={editForm.cover}
                onSelect={(path) => {
                  setEditForm({ ...editForm, cover: path });
                  setEditPhase('form');
                }}
              />
            )}
          </div>
        </div>
      )}

      <DesktopTheme />
      <style jsx>{`
        main { padding: 24px 40px 64px; max-width: 1200px; margin: 0 auto; }

        .hero { margin-bottom: 24px; }
        .hero-row {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 24px;
        }
        .hero h1 {
          font-family: var(--serif);
          font-size: 40px;
          font-weight: 400;
          letter-spacing: -0.01em;
          margin: 0 0 8px;
          color: var(--text);
          line-height: 1.15;
        }
        .meta {
          margin: 0 0 8px;
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
          display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
        }
        .dot { color: var(--text-faint); }
        .path { margin: 0; }
        .path code {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-faint);
          background: transparent;
          padding: 0;
        }

        .banner {
          background: rgba(216, 90, 70, 0.12);
          border: 1px solid rgba(216, 90, 70, 0.32);
          color: #f0bfb6;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 13px;
        }
        .empty-block {
          padding: 56px 24px;
          text-align: center;
          color: var(--text-muted);
          border: 1px dashed var(--border-strong);
          border-radius: 14px;
        }
        .empty-block p { margin: 0; }
      `}</style>
    </div>
  );
}

function Thumb({
  adapter,
  albumUrl,
  name,
  onOpen,
}: {
  adapter: StorageAdapter | null;
  albumUrl: string;
  name: string;
  onOpen: () => void;
}) {
  const { src } = useAdapterImage(adapter, `${albumUrl}/${name}`);
  return (
    <li>
      <button className="picg-thumb" onClick={onOpen} aria-label={name}>
        {src ? <img src={src} alt={name} loading="lazy" /> : <div className="picg-thumb-placeholder" />}
      </button>
    </li>
  );
}

function Lightbox({
  adapter,
  path,
  onClose,
}: {
  adapter: StorageAdapter | null;
  path: string;
  onClose: () => void;
}) {
  const { src } = useAdapterImage(adapter, path);
  const filename = path.split('/').pop() ?? path;

  return (
    <div className="picg-lightbox" onClick={onClose}>
      <button className="picg-lightbox-close" onClick={onClose} aria-label="Close">✕</button>
      {src && <img src={src} alt={filename} onClick={(e) => e.stopPropagation()} />}
      <div className="picg-lightbox-meta">
        <span>{filename}</span>
      </div>
    </div>
  );
}

function CoverField({
  adapter,
  cover,
  onPick,
  disabled,
}: {
  adapter: StorageAdapter | null;
  cover: string;
  onPick: () => void;
  disabled: boolean;
}) {
  const { src } = useAdapterImage(adapter, cover || null);
  return (
    <div className="picg-cover-field">
      <div className="picg-cover-preview">
        {src ? (
          <img src={src} alt="" />
        ) : (
          <div className="picg-cover-empty">no cover</div>
        )}
      </div>
      <div className="picg-cover-meta">
        <div className="picg-cover-path">{cover || 'No cover selected'}</div>
        <button
          type="button"
          className="btn ghost small"
          onClick={onPick}
          disabled={disabled}
        >
          {cover ? 'Change…' : 'Choose…'}
        </button>
      </div>
    </div>
  );
}

function CoverPicker({
  adapter,
  albumUrl,
  images,
  currentCover,
  onSelect,
}: {
  adapter: StorageAdapter | null;
  albumUrl: string;
  images: DirectoryEntry[];
  currentCover: string;
  onSelect: (path: string) => void;
}) {
  if (images.length === 0) {
    return (
      <div className="picg-modal-loading">No images in this album to choose from.</div>
    );
  }
  return (
    <div className="picg-cover-picker">
      <ul className="picg-thumbs">
        {images.map((img) => {
          const path = `${albumUrl}/${img.name}`;
          return (
            <CoverPickerThumb
              key={img.path}
              adapter={adapter}
              path={path}
              isCurrent={currentCover === path}
              onSelect={() => onSelect(path)}
            />
          );
        })}
      </ul>
    </div>
  );
}

function CoverPickerThumb({
  adapter,
  path,
  isCurrent,
  onSelect,
}: {
  adapter: StorageAdapter | null;
  path: string;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const { src } = useAdapterImage(adapter, path);
  const filename = path.split('/').pop() ?? path;
  return (
    <li>
      <button
        type="button"
        className={`picg-thumb ${isCurrent ? 'is-cover' : ''}`}
        onClick={onSelect}
        aria-label={`Use ${filename} as cover`}
      >
        {src ? <img src={src} alt={filename} /> : <div className="picg-thumb-placeholder" />}
      </button>
    </li>
  );
}
