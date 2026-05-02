'use client';

// CONFIG.yml editor — basic fields (title/subtitle/description/cover/author/url)
// plus the nav module catalog with toggle + drag reorder.
//
// Anything in CONFIG.yml that isn't covered by the editor is preserved
// verbatim: footer_logo, photography_page, google_analytics, follow_challenge,
// thumbnail_url / base_url / backup_*_url, root, plus any custom nav entries
// that don't map to one of the catalog modules.

import { useEffect, useState } from 'react';
import yaml from 'js-yaml';

import type { StorageAdapter } from '@/core/storage';

const CONFIG_PATH = 'CONFIG.yml';

// Catalog matches the well-known nav modules a PicG gallery exposes via
// link paths. Defaults from
// https://raw.githubusercontent.com/lfkdsk/gallery/refs/heads/master/CONFIG.yml.
type ModuleId = 'location' | 'grid-lanes' | 'grid-all' | 'random' | 'status' | 'animals';

type CatalogEntry = {
  id: ModuleId;
  link: string;            // canonical, used to detect existing entries
  defaultLabel: string;
  defaultIcon: string;
};

const CATALOG: CatalogEntry[] = [
  { id: 'location',   link: '/location',   defaultLabel: '地图',     defaultIcon: 'local-two' },
  { id: 'grid-lanes', link: '/grid-lanes', defaultLabel: '时间线',   defaultIcon: 'grid-nine' },
  { id: 'grid-all',   link: '/grid-all',   defaultLabel: '画廊',     defaultIcon: 'pic' },
  { id: 'random',     link: '/random',     defaultLabel: '随机',     defaultIcon: 'pic' },
  { id: 'status',     link: '/status',     defaultLabel: '状态监控', defaultIcon: 'list-view' },
  { id: 'animals',    link: '/animals',    defaultLabel: '动物',     defaultIcon: 'cat' },
];

const CATALOG_BY_LINK = new Map(CATALOG.map((c) => [c.link, c]));

type ModuleEntry = {
  id: ModuleId;
  label: string;
  link: string;
  icon: string;
  enabled: boolean;
};

type Basic = {
  title: string;
  subtitle: string;
  description: string;
  cover: string;
  author: string;
  url: string;
};

const EMPTY_BASIC: Basic = {
  title: '',
  subtitle: '',
  description: '',
  cover: '',
  author: '',
  url: '',
};

type LoadResult = {
  raw: Record<string, any>;       // full CONFIG.yml so we can preserve keys we don't edit
  basic: Basic;
  modules: ModuleEntry[];          // ordered: enabled-first (in file order), then disabled-catalog
  customNav: Array<[string, any]>; // nav items that aren't in the catalog — kept verbatim
};

function emptyResult(): LoadResult {
  return {
    raw: {},
    basic: { ...EMPTY_BASIC },
    modules: CATALOG.map((c) => ({
      id: c.id,
      label: c.defaultLabel,
      link: c.link,
      icon: c.defaultIcon,
      enabled: false,
    })),
    customNav: [],
  };
}

function parseConfig(text: string): LoadResult {
  const raw = (yaml.load(text, {
    schema: yaml.CORE_SCHEMA,
    json: true,
  }) ?? {}) as Record<string, any>;

  const basic: Basic = {
    title: typeof raw.title === 'string' ? raw.title : '',
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    cover: typeof raw.cover === 'string' ? raw.cover : '',
    author: typeof raw.author === 'string' ? raw.author : '',
    url: typeof raw.url === 'string' ? raw.url : '',
  };

  const navObj = (raw.nav && typeof raw.nav === 'object' ? raw.nav : {}) as Record<
    string,
    { link?: string; icon?: string } | undefined
  >;

  const moduleByLink = new Map<string, ModuleEntry>();
  const customNav: Array<[string, any]> = [];

  for (const [label, value] of Object.entries(navObj)) {
    const link = value?.link;
    if (typeof link === 'string' && CATALOG_BY_LINK.has(link)) {
      const cat = CATALOG_BY_LINK.get(link)!;
      moduleByLink.set(link, {
        id: cat.id,
        label,
        link,
        icon: typeof value?.icon === 'string' ? value.icon : cat.defaultIcon,
        enabled: true,
      });
    } else {
      customNav.push([label, value]);
    }
  }

  // Module ordering: keep enabled-and-known in their YAML order, then append
  // catalog modules that aren't yet enabled in their canonical order.
  const enabled: ModuleEntry[] = [];
  for (const [, value] of Object.entries(navObj)) {
    if (typeof value?.link === 'string' && moduleByLink.has(value.link)) {
      enabled.push(moduleByLink.get(value.link)!);
      moduleByLink.delete(value.link);
    }
  }
  const disabled: ModuleEntry[] = CATALOG
    .filter((c) => !enabled.some((m) => m.id === c.id))
    .map((c) => ({
      id: c.id,
      label: c.defaultLabel,
      link: c.link,
      icon: c.defaultIcon,
      enabled: false,
    }));

  return { raw, basic, modules: [...enabled, ...disabled], customNav };
}

function buildYaml(state: LoadResult, basic: Basic, modules: ModuleEntry[]): string {
  // Start from the full raw config to preserve unedited keys.
  const out: Record<string, any> = { ...state.raw };

  // Top-level fields. Drop empty strings rather than writing 'title: ""'.
  for (const key of Object.keys(EMPTY_BASIC) as Array<keyof Basic>) {
    const v = basic[key];
    if (v && v.trim()) out[key] = v;
    else delete out[key];
  }

  // Rebuild nav: enabled catalog modules in user order, then preserved
  // customs in their original order. Keys are display labels.
  const newNav: Record<string, any> = {};
  for (const m of modules) {
    if (!m.enabled) continue;
    newNav[m.label] = { link: m.link, icon: m.icon };
  }
  for (const [label, val] of state.customNav) {
    if (!(label in newNav)) newNav[label] = val;
  }
  if (Object.keys(newNav).length > 0) out.nav = newNav;
  else delete out.nav;

  return yaml.dump(out, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

export function EditGalleryModal({
  adapter,
  open,
  onClose,
  onSaved,
}: {
  adapter: StorageAdapter | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<LoadResult>(emptyResult);
  const [basic, setBasic] = useState<Basic>(EMPTY_BASIC);
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [draggingId, setDraggingId] = useState<ModuleId | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Read CONFIG.yml each time the modal opens. If the file's missing we
  // start blank so the user can create it from scratch.
  useEffect(() => {
    if (!open || !adapter) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    (async () => {
      try {
        const meta = await adapter.readFileMetadata(CONFIG_PATH);
        const next = meta
          ? parseConfig((await adapter.readFile(CONFIG_PATH)).text())
          : emptyResult();
        // Diagnostic: log what modules the parser detected so users
        // can paste it back when they hit "all unchecked even though
        // CONFIG.yml clearly has nav entries". Strip when stable.
        console.log('[picg edit-gallery] CONFIG.yml parsed', {
          hasFile: !!meta,
          basic: next.basic,
          modules: next.modules.map((m) => ({
            id: m.id,
            link: m.link,
            enabled: m.enabled,
          })),
          customNav: next.customNav.map(([label, v]) => ({ label, link: v?.link })),
        });
        if (cancelled) return;
        setState(next);
        setBasic(next.basic);
        setModules(next.modules);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, adapter]);

  function patchBasic(patch: Partial<Basic>) {
    setBasic((b) => ({ ...b, ...patch }));
  }

  function toggleModule(id: ModuleId) {
    setModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    );
  }

  function relabelModule(id: ModuleId, label: string) {
    setModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, label } : m))
    );
  }

  // Live reorder during drag, identical pattern to the album-card reorder
  // on the gallery list page: idempotent splice/insert keeps state stable
  // even with high-frequency dragover.
  function handleDragOver(targetId: ModuleId) {
    if (!draggingId || draggingId === targetId) return;
    setModules((prev) => {
      const fromIdx = prev.findIndex((m) => m.id === draggingId);
      const toIdx = prev.findIndex((m) => m.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
      if (insertIdx === fromIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(insertIdx, 0, moved);
      return next;
    });
  }

  async function handleSave() {
    if (!adapter) return;
    setSaving(true);
    setSaveError(null);
    try {
      const yamlText = buildYaml(state, basic, modules);
      await adapter.writeFile(CONFIG_PATH, yamlText, 'Update gallery config');
      onSaved?.();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="picg-modal-backdrop"
      onClick={() => !saving && onClose()}
    >
      <div className="picg-modal picg-modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="picg-modal-header">
          <div className="picg-modal-title-wrap">
            <h2>Edit gallery</h2>
          </div>
          <button
            type="button"
            className="btn ghost icon"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {loading ? (
          <div className="picg-modal-loading">Loading CONFIG.yml…</div>
        ) : loadError ? (
          <div className="picg-banner">{loadError}</div>
        ) : (
          <div className="picg-fields">
            <h3 className="section-h">Identity</h3>
            <label className="picg-field">
              <span>Title</span>
              <input
                value={basic.title}
                onChange={(e) => patchBasic({ title: e.target.value })}
                placeholder="我的摄影画廊"
                disabled={saving}
              />
            </label>
            <label className="picg-field">
              <span>Subtitle</span>
              <input
                value={basic.subtitle}
                onChange={(e) => patchBasic({ subtitle: e.target.value })}
                placeholder="用镜头记录美好时光"
                disabled={saving}
              />
            </label>
            <label className="picg-field">
              <span>Description</span>
              <textarea
                value={basic.description}
                onChange={(e) => patchBasic({ description: e.target.value })}
                placeholder="一句话介绍这个画廊"
                rows={3}
                disabled={saving}
              />
            </label>
            <label className="picg-field">
              <span>Cover URL</span>
              <input
                value={basic.cover}
                onChange={(e) => patchBasic({ cover: e.target.value })}
                placeholder="https://…"
                disabled={saving}
              />
            </label>
            <div className="picg-field-row">
              <label className="picg-field">
                <span>Author</span>
                <input
                  value={basic.author}
                  onChange={(e) => patchBasic({ author: e.target.value })}
                  placeholder="lfkdsk"
                  disabled={saving}
                />
              </label>
              <label className="picg-field">
                <span>Site URL</span>
                <input
                  value={basic.url}
                  onChange={(e) => patchBasic({ url: e.target.value })}
                  placeholder="https://example.com"
                  disabled={saving}
                />
              </label>
            </div>

            <h3 className="section-h">Modules</h3>
            <p className="section-hint">
              Toggle which nav modules appear, drag to reorder. Custom nav
              entries already in CONFIG.yml are preserved as-is.
            </p>
            <ul className="modules-list">
              {modules.map((m) => (
                <li
                  key={m.id}
                  className={`module-row ${draggingId === m.id ? 'is-dragging' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', m.id);
                    setDraggingId(m.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    handleDragOver(m.id);
                  }}
                  onDrop={(e) => e.preventDefault()}
                >
                  <span className="grip" aria-hidden="true">⋮⋮</span>
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={() => toggleModule(m.id)}
                    disabled={saving}
                    aria-label={`Enable ${m.id}`}
                  />
                  <input
                    className="label-input"
                    value={m.label}
                    onChange={(e) => relabelModule(m.id, e.target.value)}
                    disabled={saving || !m.enabled}
                  />
                  <code className="module-link">{m.link}</code>
                </li>
              ))}
            </ul>

            {saveError && <div className="picg-banner">{saveError}</div>}
          </div>
        )}

        <div className="picg-modal-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <style jsx>{`
        .section-h {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 500;
          margin: 0 0 -2px;
        }
        .section-h + :global(.picg-field) { margin-top: 0; }
        .section-hint {
          margin: -4px 0 4px;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }

        .picg-fields :global(textarea) {
          padding: 10px 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: inherit;
          font-size: 14px;
          outline: none;
          resize: vertical;
          min-height: 60px;
        }
        .picg-fields :global(textarea:focus) { border-color: var(--accent); }
        .picg-fields :global(textarea::placeholder) { color: var(--text-faint); }

        .modules-list {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-direction: column; gap: 4px;
        }
        .module-row {
          display: flex; align-items: center; gap: 12px;
          padding: 8px 10px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          transition: opacity 0.1s ease, border-color 0.15s ease;
        }
        .module-row:hover { border-color: var(--border-strong); }
        .module-row.is-dragging { opacity: 0.4; }
        .grip {
          color: var(--text-faint);
          cursor: grab;
          font-size: 14px;
          line-height: 1;
          letter-spacing: -2px;
          user-select: none;
        }
        .module-row input[type='checkbox'] {
          width: 16px; height: 16px;
          accent-color: var(--accent);
          cursor: pointer;
        }
        .label-input {
          flex: 1;
          padding: 6px 10px;
          background: var(--bg-card);
          border: 1px solid transparent;
          border-radius: 6px;
          color: var(--text);
          font-family: inherit;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .label-input:hover:not(:disabled) { border-color: var(--border); }
        .label-input:focus { border-color: var(--accent); }
        .label-input:disabled { color: var(--text-faint); cursor: not-allowed; }
        .module-link {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-faint);
          background: transparent;
          padding: 0;
        }
      `}</style>
    </div>
  );
}
