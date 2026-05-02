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
**either** `<userData>/galleries/<owner>__<repo>/` (default — Internal)
**or** `~/Library/Mobile Documents/com~apple~CloudDocs/PicG/<owner>__<repo>/`
(opt-in — iCloud, see §10). Users never see the path — the app is the
library, not a folder picker over their filesystem.

Methods: `list()` / `resolve(id)` / `clone(request, sender)` /
`remove(id)` / `sync(id)` / `migrateToICloud(id, sender)` /
`migrateToInternal(id, sender)` / `discoverICloud()` /
`triggerICloudDownload(paths?)`. Clone and migrate progress stream
over `CHANNELS.gallery.cloneProgress` and `.migrateProgress` events
respectively; `measureDirSize` runs after clone + sync + migration to
populate the capacity readout on cards.

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

## 6. Compression pipeline (desktop)

`electron/ipc/compress.ts` is the single hot path everything goes
through (renderer drops files → `useCompressIpc` → IPC →
`compressImage()`). Five things are non-obvious here:

- **EXIF preservation is manual**, not via sharp's `keepMetadata()`.
  We do `load(input) → strip Orientation → dump → insert(into output)`
  with `@lfkdsk/exif-library`. sharp's metadata copy was lossy across
  libvips builds (some camera makernotes / GPS sub-IFDs got dropped);
  the manual route is byte-exact except for the Orientation tag we
  drop because `.rotate()` already baked it into pixels.
- **HEIC routes through `sips`** before sharp. Sharp's prebuilt
  libheif is AOM-only — supports AV1 (so AVIF works) but not HEVC,
  and Apple HEIC is HEVC. `decodeHeicViaSips()` writes a tmp HEIC,
  invokes `sips -s format jpeg`, reads back the JPEG, then sharp
  takes over. `sips` is macOS-only — when we ship Linux/Windows we
  need a different path (libde265 build of libvips, or a wasm
  decoder). Until then the Linux/Windows DMG/MSI is hypothetical.
- **MOV passes through untouched** for Live Photos. iPhone Live Photo
  = HEIC + matching MOV. `useCompressIpc` short-circuits any video
  MIME / `.mov` extension before hitting the IPC; the file lands in
  git verbatim alongside its HEIC partner so a Live-Photo-aware
  viewer can pair them.
- **50 MP soft cap** when not lossless. `MAX_PIXELS = 50_000_000`. If
  input exceeds it (60–100 MP medium-format / mirrorless), we
  compute `scale = √(50M / inputPixels)` and resize to land at
  exactly 50 MP. Below the cap, native resolution is preserved
  (24 MP DSLR, 12 MP iPhone untouched).
- **Lossless mode** lives in `CompressionSettings.lossless`. When
  on: sharp `.webp({ lossless: true, effort: 6 })`, the 50 MP cap is
  skipped, and the JPEG output radio is forced to WebP (no useful
  JPEG-lossless exists). On web, `compress-image.ts` mirrors this
  via squoosh's `lossless: 1, exact: 1` encoder option, plus the
  squoosh resize processor for the 50 MP cap.

`effort: 6` on WebP is unconditional (5–15 % smaller for the same
quality at the cost of ~30 % encode time — invisible per-photo).

---

## 7. Thumbnail cache + visible errors

The gallery overview used to render every album cover at full
resolution — 30+ MB webp files getting decoded to fill 260 px cards.
`electron/thumbnail.ts` now sits behind the `picg://` protocol
handler:

```
picg://gallery/<id>/<path>          → original file (lightbox)
picg://gallery/<id>/<path>?thumb=W  → cached webp resized to W px wide
```

Cache key: `sha1(absPath | width | mtime)`. The `mtime` part means
replacing a photo on disk auto-invalidates the cached thumbnail. Cap
on `W` is `[64, 2048]` to keep a malicious URL from OOMing main or
filling disk. Cards thread the size through
`useAdapterImage(..., { thumbWidth })`:

- gallery overview cards: 640
- album page photo grid + cover picker: 480
- annual summary candidate grid: 480
- lightbox: unset → original

**Error surfacing.** Failures from the protocol handler used to land
as default-broken-image icons. `useAdapterImage` now does a HEAD
probe alongside the `<img>` for any `picg://` URL; on non-200 it
reads the body once and parses for the JSON shape main returns
(`{ error, message, ... }`). That feeds the existing `error` channel
of the hook, which the album card renders as an editorial
"COVER FAILED · `<reason>`" overlay.

The previous read-as-text-after-failed-json bug (body already
consumed → falls back to bare "picg:// 404") is fixed by reading
text first then attempting `JSON.parse` on the string. All
protocol errors return structured JSON with `Content-Type:
application/json` + `X-Picg-Error: 1` so the renderer can identify
them without parsing.

For the upload pages (new-album / [album]/add) we use a different
path: `makePreviewUrl(file)` in `src/components/desktop/makePreview.ts`
runs `createImageBitmap` with `resizeWidth` → OffscreenCanvas →
`convertToBlob('image/webp', 0.7)` for a ~30–80 KB preview blob,
regardless of source size. HEIC isn't decoded by Chromium so we
fall back to the original URL (broken-icon UX for HEIC previews
in upload — a future improvement is round-tripping through main's
sips path).

---

## 8. Auto-update + release flow

Built on `electron-updater`. Behaviour:

- Boot → 0.5 s later `autoUpdater.checkForUpdates()`. Then every 4 h.
- If the GitHub Release manifest version is **strictly greater**
  than the installed version (`semver.gt`, not `!==`), we download
  in the background. Progress events stream to the renderer over
  `updater:download-progress` → Topbar shows a slim bar next to
  the brand logo while bytes flow in.
- On download finish, main caches the event in
  `pendingDownloadedUpdate` and broadcasts `updater:update-downloaded`.
  Topbar renders an "Update ready · v0.x.y" pill. Click → main
  calls `autoUpdater.quitAndInstall()`.
- The cached `pendingDownloadedUpdate` is what `getPending()` IPC
  returns on Topbar mount — this **replays the event** to a Topbar
  that mounted *after* the download finished (e.g. user navigating
  between desktop pages mid-download).

Two non-obvious failure modes burned into the doc as guard rails:

- **Don't compare with `!==`** — when GitHub's `releases/latest`
  trails behind us, the manifest claims an *older* version. A `!==`
  check announced downgrades as updates. Always `semver.gt`.
- **Don't publish releases as draft.** electron-builder defaults to
  draft. Drafts are invisible to the `releases/latest` API → the
  most recent *published* release wins, which is whichever stale
  release happens to still be marked non-draft. The yml has
  `publish.releaseType: release` to force published. Old drafts
  need a one-shot `gh release edit --draft=false` to repair.

Manual recheck path: avatar menu → "Check for updates…" → calls
`updater:check-now`. Returns `{ ok, currentVersion, manifestVersion,
updateAvailable, downloaded }`. Topbar reads the shape and surfaces
an info-toast (`fireInfoToast` from `src/components/desktop/InfoToast.tsx`)
with the right message. Replaces the older `alert()` calls — info
toasts are the desktop's standard non-blocking feedback now.

### 8.1 Cutting a release

Standard flow when shipping:

1. Bump `package.json` `version` to a new semver. Tag MUST match.
2. `git commit + git push origin main`.
3. `git tag v0.X.Y && git push origin v0.X.Y`.
4. `.github/workflows/release-desktop.yml` triggers on the tag push
   → builds arm64 + x64 DMGs → publishes to a matching GitHub
   Release. `electron-builder.yml` has `mac.artifactName:
   ${productName}-${version}-${arch}.${ext}` so both DMGs get
   symmetric `-arm64` / `-x64` suffixes.
5. Verify via `gh release view vX.Y.Z` — should show
   `latest-mac.yml` + 2 DMGs + 2 blockmaps, and `gh api .../latest`
   should return the new tag.

If the workflow fails (CI build error, missing secrets, …) without
publishing: delete the tag locally + remote, fix, re-tag.

```bash
git tag -d vX.Y.Z
git push --delete origin vX.Y.Z
# fix
git tag vX.Y.Z && git push origin vX.Y.Z
```

If you want to **skip a release** and just save WIP, commit + push
without tagging. Workflow only fires on tag push.

### 8.2 Signing / notarization

Currently unsigned. Users see "PicG is damaged" on first open
(quarantine flag → Gatekeeper reject for unsigned).

Mitigation we ship today: the DMG includes
`build/fix-gatekeeper.command`, dropped into the DMG window next to
the app + Applications symlink as **"Fix Gatekeeper.command"**. After
dragging PicG to Applications the user double-clicks it — macOS shows
the standard "are you sure you want to open this?" prompt (the
.command inherited the same quarantine flag), they click Open, the
script runs `xattr -c /Applications/PicG.app`, and PicG launches
normally from then on. Trade-off vs. doing nothing: one less-scary
prompt instead of "is damaged → move to Trash."

Manual fallback in the release notes for users who prefer Terminal:

```bash
xattr -c /Applications/PicG.app
```

To actually sign:

1. Apple Developer Program ($99/yr) → "Developer ID Application"
   cert.
2. Export `.p12`, `base64 -i cert.p12 -o cert.b64`.
3. Add GitHub secrets: `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`,
   `APPLE_ID`, `APPLE_ID_PASSWORD` (app-specific password),
   `APPLE_TEAM_ID`.
4. Uncomment the `CSC_LINK / CSC_KEY_PASSWORD / APPLE_*` env block
   in `.github/workflows/release-desktop.yml`.
5. Set `mac.identity` in `electron-builder.yml`, flip
   `hardenedRuntime: true`.

Not yet done. Tracked in §11 backlog.

---

## 9. Singletons & lifecycle gotchas

These bit us in production once each — keep them in mind.

### 9.1 GalleryRegistry must be one instance

`electron/ipc/gallery.ts` exports `getRegistry()`. The picg://
protocol handler in main must use **that** function, not
`new GalleryRegistry()`. Two instances = two manifest caches = a
gallery cloned via IPC after the protocol side has already cached
the manifest will 404 forever (until next launch). Symptom: every
album cover in a freshly-cloned gallery shows "COVER FAILED ·
gallery-not-found".

### 9.2 Stable port across activate

`pickStablePort()` writes the chosen port to
`<userData>/picg-port` and reuses it on next launch. Without this,
each cold launch would pick a fresh free port → the Next standalone
server's URL changes → renderer's `localStorage` is keyed by
origin → user has to re-sign-in every time.

### 9.3 Cache the resolved app URL across `app.activate`

On macOS, closing the window doesn't quit. `app.on('activate')`
fires later when the user clicks the dock icon, and we re-create
the window. The Next server we forked is still alive on the same
port. **Don't re-spawn or re-pick the port** — the persisted port
is held by our own server, `pickStablePort` falls through to a new
one, new origin, localStorage gone. `cachedAppUrl` in
`electron/main.ts` reuses the URL until the spawned server actually
exits.

### 9.4 Push must go through `origin`, not a raw URL

`git push <token-url> <branch>` does the upload but doesn't update
`refs/remotes/origin/<branch>`. The Topbar's ahead-counter then
shows the same number forever, even after a successful push. Fix:
override the URL inline with `git -c remote.origin.url=<token-url>
push origin <branch>`. The `-c` keeps the token off `.git/config`.

Same call path also pins `http.postBuffer=524288000` and
`http.version=HTTP/1.1` to dodge GitHub's HTTP/2 sideband-disconnect
on multi-MB pushes.

### 9.5 Squash unpushed commits at push time

`maybeSquash()` collapses everything ahead of `origin/<branch>` into
a single commit before push, with the original subject lines listed
in the body. Local stays granular for the Undo toast; remote stays
readable. On push failure we `git reset --hard <preSquashSha>` so
the user keeps their per-op Undo grain.

---

## 10. iCloud sync (Mac-only)

A gallery's working tree can live in the user's iCloud Drive instead
of inside `<userData>`. iCloud Drive then handles cross-Mac sync of
both the photo files and the `.git` directory; nothing else in the
architecture changes — the same `LocalGitStorageAdapter` reads/writes
through `fs/promises` regardless of where the path resolves to, and
publishing still goes through `git push` → CI → deployed site as
described in §0.

### 10.1 Layout

```
~/Library/Mobile Documents/com~apple~CloudDocs/PicG/
├── alice__landscape-2024/      ← gallery 1, full clone with .git
└── alice__europe-trip/         ← gallery 2
```

`com~apple~CloudDocs` is the OS-mandated mount point for iCloud Drive
on macOS; we hard-code it. The `PicG/` subfolder is intentionally
literal — the user can find it in Finder / Files.app and recognize
it. We don't use a bundle id like `com.lfkdsk.picg`.

### 10.2 Migration

`GalleryRegistry.migrateToICloud(id, sender)` (and its inverse
`migrateToInternal`) copies the entire working tree to the new
location, verifies the file count matches, atomically swaps
`localPath` in the manifest, then deletes the source. Progress
streams as `MigrateProgress` events on `CHANNELS.gallery.migrateProgress`
through five phases: `counting → copying → verifying → cleanup → done`.
The renderer (`/desktop/galleries`) renders the card's action row as a
progress bar while a migrate is in flight.

If anything fails before the manifest swap, the source is intact and
we delete the half-copied destination so the user can retry. After
the swap, source removal failure is logged but treated as recoverable
garbage — the manifest already points to the new path so the user's
view is correct.

### 10.3 Discovery on startup

`discoverICloud()` runs in `app.whenReady` (see [main.ts](../electron/main.ts))
and scans `PicG/` for subdirectories whose name matches `<owner>__<repo>`,
that contain a `.git/` directory, and whose `origin` remote points
at `https://github.com/<owner>/<repo>(.git)?`. Folders that pass all
three checks and aren't already in this Mac's manifest get
auto-registered. Folders that fail any check are silently skipped and
logged — better to miss a gallery than to import the user's stray
folder.

This is the mechanism that lets a gallery migrated on Mac A appear on
Mac B without a re-clone. It's a one-shot at startup; we don't poll
for newly-arrived iCloud folders during a session.

### 10.4 Materialization (`brctl download`)

iCloud's "Optimize Mac Storage" silently evicts files to placeholder
form (`.foo.jpg.icloud`) when disk is tight, and **a placeholder breaks
us** — `fs.readFile` returns `EIO`, sqlite errors, sharp can't decode.

We mitigate two ways:

- **At startup**, `triggerICloudDownload()` fires `brctl download
  <path>` against every iCloud-rooted gallery in the manifest.
  Already-downloaded files are no-ops; placeholders queue a
  background materialization.
- **After every migrate-to-iCloud**, the same call runs against the
  new destination so the source-of-truth Mac doesn't immediately
  hand its own files back to iCloud as placeholders.

`brctl` is shell-out, fire-and-forget — we don't await its
completion, only the queue acceptance. The right user-side fix is
**System Settings → iCloud Drive → PicG folder → "Always Keep
Downloaded"**; surfacing this hint in the UI is on the backlog.

### 10.5 Known invariants

- **Single-machine-at-a-time editing.** iCloud doesn't have Git's
  conflict resolution. Concurrent edits on Mac A and Mac B before
  iCloud finishes propagating produce silent `xxx 2.json` conflict
  files in `.git/refs/` or working tree. Document; v1 has no UI for
  detection.
- **Always close the app before switching machines.** sqlite WAL
  files (if any are left around by a future feature; current code
  doesn't write sqlite from the desktop) and `.git/index.lock` need
  to be committed/cleared before iCloud can sync them safely.
- **No on-demand download.** v1 assumes the whole library is
  materialized. A future enhancement can scan for `.icloud`
  placeholders and lazy-download as the user navigates, with
  thumbnail-level "downloading" overlays.

### 10.6 Code paths

| Concern | File |
|---|---|
| Registry methods | [`electron/galleries/GalleryRegistry.ts`](../electron/galleries/GalleryRegistry.ts) (search `iCloud`) |
| IPC channels | [`electron/ipc/contract.ts`](../electron/ipc/contract.ts) — `gallery.migrate` / `discover` / `migrateProgress` / `iCloudRoot` |
| IPC handlers | [`electron/ipc/gallery.ts`](../electron/ipc/gallery.ts) |
| Preload bridge | [`electron/preload.ts`](../electron/preload.ts) |
| Startup wiring | [`electron/main.ts`](../electron/main.ts) (`discoverICloud` + `triggerICloudDownload` after `app.whenReady`) |
| Renderer UI | [`src/app/desktop/galleries/page.tsx`](../src/app/desktop/galleries/page.tsx) (storage badge, Move action, migrate progress) |

---

## 11. Backlog / known gaps

These are deliberately undone, and listed here so the next person
doesn't redo investigations.

- **`DatabaseAdapter`** — *not* needed and not worth doing. Annual
  summary now lives at `/desktop/galleries/[id]/annual-summary[/year]`
  and intentionally reads `sqlite.db` from the same CDN URL the web
  flow uses (see `openDeployedGalleryDb` in
  `src/components/desktop/galleryDb.ts`). Building the DB locally
  would mean owning the rendering layer (template + theme + build.py)
  — an explicit non-goal per §0.
- **macOS code signing + notarization** — see §8.2. Cert costs $99/yr;
  workflow secrets pre-wired (commented out). Without it users hit
  "PicG is damaged" → must run `xattr -cr` or right-click open.
- **HEIC on Linux / Windows** — `decodeHeicViaSips` is macOS-only.
  Replace with libde265 in libvips, or a wasm HEIC decoder, before
  we ship Linux/Windows builds.
- **HEIC preview in upload page** — `makePreviewUrl` falls back to
  the original `URL.createObjectURL(file)` for HEIC because Chromium
  can't decode HEIC. Round-tripping through main's `sips` for the
  preview would fix it (small IPC cost, one-time per file).
- **CONFIG.yml modules detection bug** — user reported a gallery
  whose `nav` entries are valid but the editor shows everything
  unchecked. Parser run in isolation (Node + same code) returns
  correct results. Diagnostic `console.log` was added to the modal
  load path (`[picg edit-gallery] CONFIG.yml parsed`). Root cause
  not yet confirmed; suspects are state-update timing (modal opens
  while `adapter` is briefly null) or a render-side stale closure.
  Next step: reproduce in dev mode with DevTools open and capture
  the diagnostic.
- **Live-Photo MOV preview** — accepted in upload; the `<img>` tag
  shows a broken icon during the preview phase (no video frame
  extraction). Best fix: detect `.mov` in `makePreviewUrl`, skip
  the bitmap path, render a small video icon placeholder.
- **Per-photo EXIF in lightbox** — albums show the per-album location
  from README.yml; per-photo GPS / camera / lens read from each
  image's EXIF is not done. Web doesn't show it either.
- **Cover failed on stale manifest** — the `gallery-not-found` overlay
  is a useful diagnostic but with §9.1 fixed it should never fire.
  If it ever does in production again, the cause is NOT a race: the
  manifest itself is wrong (stale entry, repo deleted under us, …).
- **Auto-update for dev builds** — `initAutoUpdater()` returns early
  when `!app.isPackaged`. There's no way to test the full update
  flow without packaging two builds and installing the older one.
- **iCloud "Always Keep Downloaded" hint** — when the user moves a
  gallery to iCloud (§10), we should prompt them to right-click the
  PicG folder in Finder and pick "Always Keep Downloaded". Without
  it, "Optimize Mac Storage" can evict files to placeholders and
  break reads. `triggerICloudDownload` mitigates but doesn't prevent
  re-eviction. UI for the hint is the missing piece.
- **iCloud conflict file detection** — concurrent edits across two
  Macs before iCloud finishes propagating produce silent
  `xxx 2.json` / `xxx 2.jpg` conflict files. Detecting them on
  startup and surfacing a "merge or discard" UI is on the iCloud
  v2 list.
- **On-demand iCloud download** — current code assumes the whole
  library is materialized. A v2 enhancement scans for `.icloud`
  placeholders during gallery navigation and lazy-downloads with
  per-thumbnail "downloading" overlays, instead of the upfront
  `brctl download` that we do today.

---

## 12. File map cheat sheet

```
electron/                                  Electron main process
├ main.ts                                  boot, BrowserWindow, port pick, picg:// protocol, dev/prod URL resolution
├ preload.ts                               contextBridge → window.picgBridge
├ updater.ts                               electron-updater wiring (semver-aware checkNow + replay cache)
├ thumbnail.ts                             on-disk thumb cache for picg://?thumb=W
├ tsconfig.json                            CommonJS, dist → electron/dist/
├ ipc/
│  ├ contract.ts                           IPC channels + payload types (single source of truth)
│  ├ auth.ts                               token in <userData>/auth.json (mode 0600)
│  ├ compress.ts                           sharp + sips HEIC route + 50 MP cap + lossless + EXIF supplement
│  ├ gallery.ts                            getRegistry() singleton — used by both IPC and protocol handler
│  └ storage.ts                            StorageAdapter handlers (read / write / delete)
├ galleries/
│  └ GalleryRegistry.ts                    manifest + on-disk repo management; squash-on-push lives here
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
   ├ PreloadBridgeAdapter.ts               renderer-side StorageAdapter + PicgBridge type (mirror of electron/ipc/contract.ts)
   ├ galleryTypes.ts                       LocalGallery + CloneProgress (shared with main)
   └ index.ts

src/components/
├ DesktopChrome.tsx                        Topbar + DesktopTheme + InfoToastHost mount + update progress UI
└ desktop/
   ├ EditGalleryModal.tsx                  CONFIG.yml editor (modules catalog + drag reorder)
   ├ InfoToast.tsx                         lightweight info / error toast (replaces alert())
   ├ UndoToast.tsx                         action toast for single-commit mutations
   ├ makePreview.ts                        createImageBitmap → webp blob, used by upload pages
   ├ useCompressIpc.ts                     hook: bridge.compress.image with passthrough for MOV
   ├ useAdapterImage.ts                    hook: picg:// URL with optional ?thumb=W + error-overlay probe
   └ galleryDb.ts                          openDeployedGalleryDb (annual summary reads CDN sqlite.db)

src/app/desktop/                           All desktop routes
├ login/page.tsx                           OAuth landing
├ login/token/page.tsx                     PAT fallback
├ galleries/page.tsx                       library list (hero-row layout: title left + Add gallery right)
├ galleries/[id]/page.tsx                  gallery detail (album grid + reorder + cover error overlay)
├ galleries/[id]/new-album/page.tsx        create album wizard
├ galleries/[id]/[album]/page.tsx          album detail (thumbnails + lightbox)
├ galleries/[id]/[album]/add/page.tsx      add photos to existing album
├ galleries/[id]/annual-summary/page.tsx   year list
├ galleries/[id]/annual-summary/[year]/page.tsx  monthly picker
└ settings/page.tsx                        compression settings (lossless toggle here)

src/lib/
├ github.ts                                Backwards-compat facade over StorageAdapter
├ auth.ts                                  OAuth helpers (mostly web-flow specific)
├ settings.ts                              CompressionSettings shape + localStorage I/O
├ compress-image.ts                        squoosh + EXIF wrapper for the web flow (mirrors desktop's 50 MP cap + lossless)
├ annualSummary.ts                         sql.js queries (platform-agnostic, ready to reuse)
└ sqlite.ts                                sql.js loader — fetches from CDN; needs an adapter

build/icon.svg                             single source of truth for app icon (920×920 inset, inktype palette)
scripts/build-icon.js                      svg → icns/png via sharp + iconutil
scripts/stage-standalone.js                copies .next/static + public into .next/standalone for packaging
scripts/after-pack.js                      strips Chromium locales except en/zh during electron-builder afterPack

electron-builder.yml                       packaging config (asarUnpack, max compression, locale strip, github publish)
.github/workflows/release-desktop.yml      tag-push → DMG → publish to GitHub Release
```
