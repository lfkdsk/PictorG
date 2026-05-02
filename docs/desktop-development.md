# PicG Desktop — Development Guide

The desktop variant of PicG is an Electron app that mounts the existing
Next.js renderer and routes file system + git work through a typed preload
bridge into the main process. Its central abstraction is the
`StorageAdapter`, swapped between a `GitHubStorageAdapter` (web) and a
`LocalGitStorageAdapter` (desktop) so the same business logic powers both.

This doc is the entry point for anyone touching the desktop code. Read it
end-to-end before adding a new desktop page or mutating one of the
abstractions.

---

## 0. Scope — desktop is a data-layer editor

PicG splits across three repos in production:

1. **gallery repo** — what the user owns: `README.yml`, `CONFIG.yml`, the
   per-album image directories.
2. **gallery-template** — Python SSG that pulls a gallery + a theme and
   produces the deployed static site, including `sqlite.db` (an EXIF
   index over every photo).
3. **theme** — the look-and-feel module the template clones in alongside
   the gallery.

CI clones all three and runs `build.py`. The desktop app only owns the
first one. Everything that's a CI derivative — the static HTML, the
thumbnails the deployed site serves, `sqlite.db` — is consumed *from*
the deployed site, never built locally.

This boundary keeps the desktop tool small (no Python, no theme version
matrix, no duplicated build path) and gives the user one mental model:
edit locally → push → CI deploys → desktop reads the new derivatives.
The trade-off: anything that depends on a CI-built file (annual summary,
which queries `sqlite.db`) reflects the *last deployed* state. Photos
the user just added but hasn't pushed yet won't appear there until the
next CI run completes. That matches the web flow exactly and is on
purpose.

If a future feature seems to want a local `build.py` invocation —
"preview my site before pushing", "annual summary based on local edits"
— treat it as a request to cross this boundary. Push back hard.

---

## 1. Architecture

```
┌─ Electron main (Node) ──────────────────────────────────────────┐
│                                                                 │
│   GalleryRegistry  ─────────────  <userData>/galleries.json    │
│   (electron/galleries)            <userData>/galleries/<id>/   │
│        │                                                        │
│        │ creates per-call                                       │
│        ▼                                                        │
│   LocalGitStorageAdapter  ──────  fs/promises + simple-git     │
│   (electron/storage)                                            │
│        │                                                        │
│        │ exposed via                                            │
│        ▼                                                        │
│   ipcMain.handle (electron/ipc/{gallery,storage}.ts)            │
└────────────────────────┬────────────────────────────────────────┘
                         │ IPC (structured-clone safe)
┌────────────────────────▼────────────────────────────────────────┐
│ Electron renderer = Chromium = Next.js renderer                 │
│                                                                 │
│   preload.ts contextBridge → window.picgBridge                  │
│        │                                                        │
│        ▼                                                        │
│   PreloadBridgeAdapter  ──────  implements StorageAdapter       │
│   (src/core/storage/electron)                                   │
│                                                                 │
│   Pages under /desktop/* consume the adapter directly.          │
└─────────────────────────────────────────────────────────────────┘
```

### 1.1 `StorageAdapter` (cross-platform)

Defined in `src/core/storage/StorageAdapter.ts`. Per-gallery, stateful,
no DOM/Node dependencies. Binary content is `Uint8Array | string`; strings
are treated as utf-8.

Two implementations:

| | `GitHubStorageAdapter` (web) | `LocalGitStorageAdapter` (desktop) |
|---|---|---|
| backing store | GitHub Contents + Git Data APIs | local working tree + simple-git |
| writes | one HTTP commit per `writeFile` / `batchWriteFiles` | `fs.writeFile` → `git add` → `git commit` |
| `autoPush` | implicit (every write hits remote) | configurable, **default off** in dev (see §4.1) |
| token | per-call header | embedded in clone URL once, then stripped from `.git/config` |

Top-level operations that don't fit the per-gallery shape (`listRepos`,
`createRepo`, `validateToken`, `checkTokenPermissions`,
`checkRepositorySecret`) live as standalone helpers in
`src/core/storage/github/api.ts`.

### 1.2 `GalleryRegistry` (App-managed library)

`electron/galleries/GalleryRegistry.ts` owns the user's gallery library.
Manifests live at `<userData>/galleries.json`; cloned repos live at
`<userData>/galleries/<owner>__<repo>/`. Users never see the path — the
app is the library, not a folder picker over their filesystem.

Methods: `list()` / `resolve(id)` / `clone(request, sender)` /
`remove(id)` / `sync(id)`. Clone progress streams back over
`CHANNELS.gallery.cloneProgress` events; `measureDirSize` runs after
clone + sync to populate the capacity readout on cards.

### 1.3 `PreloadBridgeAdapter` (renderer → main)

`src/core/storage/electron/PreloadBridgeAdapter.ts`. Implements
`StorageAdapter` by forwarding every call to `window.picgBridge.storage.*`.
The contextBridge surface is typed in
`electron/ipc/contract.ts` (kept in sync with the renderer's structural
type). All FS / git work happens in main; the renderer is sandboxed-ish.

`getPicgBridge()` returns the bridge or `null` — UI code uses this to
detect "are we running inside the desktop app or in a web browser tab?".

### 1.4 Web Worker for compression

`src/components/desktop/compressWorker.ts` re-exports `compressImage`
into a dedicated Worker. The companion hook
(`src/components/desktop/useCompressWorker.ts`) lazily spins up the
worker on first call, multiplexes requests by uuid, and tears it down on
unmount.

**Why the worker exists:** Squoosh's encoders already run in their own
workers, but `@lfkdsk/exif-library` and `FileReader.readAsBinaryString`
are synchronous and operate on multi-MB binary strings. They block the
main thread for hundreds of ms to seconds per photo, queuing all clicks
during a batch. The worker isolates that.

---

## 2. Routing

| Path | Page |
|---|---|
| `/desktop/galleries` | App-managed library list |
| `/desktop/galleries/[id]` | Gallery detail (album grid) |
| `/desktop/galleries/[id]/new-album` | Create new album wizard |
| `/desktop/galleries/[id]/[album]` | Album detail (thumbnail grid + lightbox) |
| `/desktop/galleries/[id]/[album]/add` | Add photos to existing album |
| `/desktop/settings` | Compression settings (parity with web `/settings`) |

### 2.1 Cross-route navigation must use `window.location.assign`

`router.push` / `router.replace` cross-route in Next 14 dev sometimes
lands on a stale webpack runtime, producing
`__webpack_require__.C is not a function` or
`Cannot find module './948.js'` right after the underlying file system
work already finished. Use `window.location.assign(href)` for any
post-mutation cross-route nav so the next page is fetched against a
fresh `page.js`.

Same-route navigations (e.g. add-photos posting back to the album with
a `?t=${Date.now()}` cache buster) keep `router.push` — they don't
recompile a target page.

### 2.2 Refresh signal

When a child page mutates state and navigates back to a parent that's
already mounted, append `?t=${Date.now()}`. The parent page passes
`searchParams.get('t')` as a `useEffect` dep, which triggers a
re-fetch.

### 2.3 typedRoutes friction

`experimental.typedRoutes` is on. Dynamic segments + template literals
don't compose well with the generated types; use `as any` on `href`
when you must construct the URL at runtime. (Native string literals
work fine.)

---

## 3. Styling conventions

The desktop chrome lives in `src/components/DesktopChrome.tsx`. It
exports `<Topbar />` and `<DesktopTheme />`; every desktop page mounts
both. The theme component injects CSS variables on `:root` plus a
shared global rule block — the **only** sanctioned place for
cross-page styles.

### 3.1 Global block uses `picg-` prefix

Anything that's reused on more than one page lives in the global
block under `picg-` prefix:

- Layout / theme: `picg-back-link`, `picg-album-card`, `picg-thumb`,
  `picg-thumbs`, `picg-lightbox`, `picg-modal-*`, `picg-fields`,
  `picg-field`, `picg-banner`, `picg-warning`, `picg-confirm-text`,
  `picg-cover-field`, `picg-cover-picker`, `picg-icon-btn`,
  `picg-menu-anchor`, `picg-menu`, `picg-menu-item` (with `.danger`
  variant), `picg-menu-divider`, `picg-menu-overlay`.
- Buttons: `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.ghost.small`,
  `.btn.ghost.icon`, `.btn.danger`, `.btn.primary.danger`. Already
  globally defined in `DesktopTheme`.

### 3.2 Why global, not scoped: the styled-jsx + next/link footgun

`<style jsx>` blocks in a component get a hash class, and styled-jsx
appends that hash to every element React renders below it. **Except**:
when `next/link` renders an `<a>`, the styled-jsx hash sometimes fails
to attach. The default user-agent style (blue underlined link) wins
and you get an obvious visual regression.

We've seen this happen at least three times during the spike (album
back-link, gallery card link, Topbar Settings menu item). Rule:
**any class that styles a `next/link`-rendered anchor must live in the
global block.** Same for any class that styles a Modal's interior —
modals are React-tree descendants of the page but visually float;
some scoped rules don't latch on consistently. Save yourself the
debugging round and start global if it's reused.

If you're sure a class only appears inside one component, scoped is
still fine and is the default in this codebase. Default to scoped,
escalate to global on the first cross-component reuse or the first
"weird styling glitch on a Link/Modal" report.

### 3.3 Don't use sandbox in the BrowserWindow

Already disabled in `electron/main.ts`. A sandboxed preload can only
`require` `electron`, `events`, `timers`, `url` — our split
`preload.ts` ↔ `ipc/contract.ts` setup needs to require sibling
modules. `contextIsolation: true` + `nodeIntegration: false` remain on,
which is the security perimeter that actually matters for the
renderer; bundling the preload to re-enable sandbox is a follow-up.

---

## 4. Safety / known invariants

### 4.1 `PICG_AUTOPUSH=0` is the default

`LocalGitStorageAdapter` does NOT push by default. Writes commit
locally; getting changes onto GitHub is a separate user gesture
(currently absent — see §6). To enable auto-push during local
testing: `PICG_AUTOPUSH=1 npm run electron:dev`.

### 4.2 Token handling

When the user picks a repo to clone, the renderer hands the token to
main over IPC. Main embeds it in the clone URL once
(`https://oauth2:<token>@github.com/...`), runs `git clone`, then
**immediately** resets `origin` to the un-tokenized URL so the token
doesn't persist in `.git/config`. Main doesn't store the token
elsewhere. macOS Keychain integration is a future improvement.

### 4.3 Path traversal

`LocalGitStorageAdapter.absolute()` rejects any input that starts with
`..` or that's an absolute path. Every read/write/delete uses it as
the path resolver, so renderer-supplied paths can't escape the gallery
directory.

### 4.4 contextIsolation always on

The preload exposes a typed object via `contextBridge.exposeInMainWorld`.
Renderer code never has `require`, `process`, or direct IPC access.

### 4.5 Cross-route `window.location.assign`

Re-stating from §2.1 because this is a safety property too: when a
destructive flow finishes (album delete, gallery delete), don't
SPA-navigate. The data work is done by the time we route — losing
the navigation to a webpack runtime crash strands the user looking
at an error page even though state is consistent.

---

## 5. Dev workflow

### 5.1 Node version

Project requires Node 18+ (Next 14 hard requirement). `nvm use 20` is
what the spike was developed against. If `node --version` shows < 18,
switch before doing anything.

### 5.2 Two-process dev loop

```bash
# Terminal A — Next dev server
nvm use 20
npm run dev          # webpack
# or
npm run dev:turbo    # turbopack (opt-in; doesn't have chunk-drift, but
                     # styled-jsx + Web Worker compatibility is unverified)

# Terminal B — Electron
npm run electron:dev # tsc -p electron && electron electron/dist/electron/main.js
```

Default URL is `localhost:3000/desktop/galleries`; override with
`PICG_DEV_URL`. `PICG_DEVTOOLS=1` opens the renderer DevTools on launch.

### 5.3 When dev breaks: the cheat sheet

| Symptom | Most likely cause | Fix |
|---|---|---|
| `Cannot find module './948.js'` | Next dev chunk hash drift, renderer cached old `page.js` | `⌘+Shift+R` in the Electron window (clears HTTP cache + reloadIgnoringCache; wired in `main.ts`) |
| `__webpack_require__.C is not a function` | Same root cause, different surface | `⌘+Shift+R` |
| White screen, no console error | next dev still compiling first request | wait, then `⌘+R` |
| `MODULE_NOT_FOUND` from `next build` cold | Worker race in the `Collecting page data` phase | run `next build` again; subsequent build passes |
| Settings link blue + underlined | A new styled-jsx scoped rule failed on a `next/link` anchor | move the rule to the global block under `picg-` prefix |
| `electron:dev` fails with `Cannot find module 'electron/...preload.js'` | `electron/dist` got out of sync with source | `rm -rf electron/dist && npm run electron:build` |

If `⌘+Shift+R` doesn't fix it within a couple tries, escalate:
`Ctrl+C` Next dev, `rm -rf .next`, `npm run dev`. Worktrees keep
their own `.next`, so this only nukes the local dev cache.

### 5.4 The worktree convention

Spike was developed on `claude/funny-vaughan-bbebb5` in
`.claude/worktrees/funny-vaughan-bbebb5`. Each worktree has its own
`node_modules` + `.next` — they don't share. Run `npm install` once
inside the worktree before `npm run dev` for the first time.

### 5.5 No `next build` in the worktree without a clean

Running `next build` in a worktree leaves a production-shaped `.next`
directory; the next `next dev` invocation will pick up some of those
artefacts and chunk-drift instantly. Habit: `rm -rf .next && npm run dev`
after any production build, or just don't `next build` in a worktree
that's also running dev.

---

## 6. Backlog / known gaps

These are deliberately undone, and listed here so the next person
doesn't redo investigations.

- **`DatabaseAdapter`** — *not* needed and not worth doing. Annual
  summary now lives at `/desktop/galleries/[id]/annual-summary[/year]`
  and intentionally reads `sqlite.db` from the same CDN URL the web
  flow uses (see `openDeployedGalleryDb` in
  `src/components/desktop/galleryDb.ts`). Building the DB locally
  would mean owning the rendering layer (template + theme + build.py)
  — an explicit non-goal per §0. If you find yourself wanting a local
  DB, the answer is "push and let CI rebuild it".
- **OAuth in Electron** — currently the user has to paste a PAT at
  `/login/token`. The web OAuth flow does
  `window.location.href = github.com/...` which will replace the
  Electron renderer. Solution: `shell.openExternal` to the system
  browser + a custom protocol callback (`picg://oauth/callback`). The
  lfkdsk-auth Cloudflare Worker would need to redirect to that
  protocol; not done.
- **Production packaging** — `npm run electron:dev` requires a
  separately-running Next dev server. For a real distributable:
  `electron-builder` for signing + notarization, plus either Next
  static export (`output: 'export'` in `next.config.js` if all routes
  can be static) or a `next start` server inside main. Trade-offs not
  yet evaluated.
- **Token in Keychain** — see §4.2. Replace IPC-passed-each-clone with
  Keychain storage so re-clones don't need the user to paste again.
- **Custom protocol for thumbnails** — every thumbnail currently goes
  through IPC + base64 + data URL. For an album with hundreds of
  photos that's a real bottleneck. `protocol.handle('picg', ...)` in
  main + `<img src="picg://...">` would short-circuit to direct
  `file://` reads, no IPC.
- **Album drag reorder past the last card** — drop targets are the
  cards themselves, so dragging "to the end" requires dropping on the
  last card. A trailing drop zone would fix it.
- **EXIF GPS in the lightbox** — albums have a per-album location in
  README.yml that's already shown; per-photo GPS read from each
  image's EXIF is not done. Web doesn't show it either.

---

## 7. File map cheat sheet

```
electron/                                  Electron main process
├ main.ts                                  app boot, BrowserWindow, IPC register
├ preload.ts                               contextBridge → window.picgBridge
├ tsconfig.json                            CommonJS, dist → electron/dist/
├ ipc/
│  ├ contract.ts                           IPC channels + payload types (single source of truth)
│  ├ gallery.ts                            list / resolve / clone / remove / sync handlers
│  └ storage.ts                            StorageAdapter handlers (read / write / delete)
├ galleries/
│  └ GalleryRegistry.ts                    manifest + on-disk repo management
└ storage/
   └ LocalGitStorageAdapter.ts             fs/promises + simple-git impl

src/core/storage/                          Cross-platform storage abstraction
├ StorageAdapter.ts                        the interface
├ types.ts                                 Repo / DirectoryEntry / FileContent / etc.
├ encoding.ts                              utf-8 / base64 (works in browser + Node)
├ path.ts                                  URL-safe path encoding
├ index.ts                                 top-level re-exports
├ github/
│  ├ GitHubStorageAdapter.ts               StorageAdapter via GitHub Contents + Git Data APIs
│  ├ api.ts                                listRepos / createRepo / token introspection
│  └ index.ts
└ electron/
   ├ PreloadBridgeAdapter.ts               renderer-side StorageAdapter via window.picgBridge
   ├ galleryTypes.ts                       LocalGallery + CloneProgress (shared with main)
   └ index.ts

src/components/
├ DesktopChrome.tsx                        Topbar + DesktopTheme (global rules live here)
└ desktop/
   ├ EditGalleryModal.tsx                  CONFIG.yml editor
   ├ compressWorker.ts                     Worker entry — re-exports compressImage
   ├ useCompressWorker.ts                  hook around the worker
   └ useAdapterImage.ts                    hook: adapter.readFile → data URL with cache

src/app/desktop/                           All desktop routes
├ galleries/page.tsx                       library list
├ galleries/[id]/page.tsx                  gallery detail (album grid + reorder)
├ galleries/[id]/new-album/page.tsx        create album wizard
├ galleries/[id]/[album]/page.tsx          album detail (thumbnails + lightbox)
├ galleries/[id]/[album]/add/page.tsx      add photos to existing album
└ settings/page.tsx                        compression settings

src/lib/
├ github.ts                                Backwards-compat facade over StorageAdapter
├ auth.ts                                  OAuth helpers (mostly web-flow specific)
├ settings.ts                              CompressionSettings shape + localStorage I/O
├ compress-image.ts                        squoosh + EXIF wrapper (used by the worker)
├ annualSummary.ts                         sql.js queries (platform-agnostic, ready to reuse)
└ sqlite.ts                                sql.js loader — fetches from CDN; needs an adapter
```
