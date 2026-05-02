// Electron main process entry. Boots the BrowserWindow, registers IPC
// handlers, and wires the renderer to:
//   - dev mode: a running `next dev` on PICG_DEV_URL (default :3000)
//   - packaged mode: a forked Next standalone server we spawn at startup
//     against `app.getAppPath()/.next/standalone/server.js`. The server
//     listens on a random free port; we discover it, then loadURL.

import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron';
import { ChildProcess, fork } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

import { getOrCreateThumbnail, parseThumbWidth } from './thumbnail';
import { initAutoUpdater } from './updater';

// Surface unhandled errors via console.log so they're visible when the
// app is launched from a terminal (and via Console.app's process logs
// for `open`-launched bundles). These are cheap insurance — without
// them an uncaught exception in the main process exits silently with 0.
process.on('uncaughtException', (err) => {
  console.error('[picg] uncaughtException', err?.stack ?? String(err));
});
process.on('unhandledRejection', (reason) => {
  console.error(
    '[picg] unhandledRejection',
    reason instanceof Error ? reason.stack : String(reason)
  );
});

import { CHANNELS } from './ipc/contract';
import type { OAuthCallbackPayload } from './ipc/contract';
import { registerAuthIpcHandlers } from './ipc/auth';
import { registerCompressIpcHandlers } from './ipc/compress';
import { getRegistry, registerGalleryIpcHandlers } from './ipc/gallery';
import { registerStorageIpcHandlers } from './ipc/storage';

// `picg://oauth/#oauth_token=...` is the redirect URL the lfkdsk-auth
// Worker hands back after a desktop sign-in. macOS routes that to this
// app via LaunchServices once we register as the protocol's default
// handler; Windows/Linux pass it as a command-line arg to a freshly-
// launched instance, which we forward to the existing one over the
// single-instance lock.
const PROTOCOL = 'picg';

// Hold the URL until a window is ready to receive it. open-url can fire
// before app.whenReady when the user clicked a picg:// link with no
// running PicG.
let pendingOAuthUrl: string | null = null;

// Default to the desktop spike landing page; existing web routes still work
// if you override PICG_DEV_URL.
const DEV_URL = process.env.PICG_DEV_URL ?? 'http://localhost:3000/desktop/galleries';

// Handle to the forked Next standalone server in packaged mode. Kept at
// module scope so app.on('quit') can SIGTERM it cleanly.
let nextServer: ChildProcess | null = null;

// Cache the URL we resolved on first launch. On macOS, closing the
// window (red traffic-light) doesn't quit the app — `app.on('activate')`
// fires later when the user clicks the dock icon and we re-create the
// window. The Next server we forked at startup is still running on
// the same port; if we asked pickStablePort() again it would try to
// bind that same port, fail (because our own server has it), and
// fall back to a fresh port. The new origin would have an empty
// localStorage and the user would have to sign in again. Reusing the
// resolved URL keeps the origin stable across activate cycles.
let cachedAppUrl: string | null = null;

// Try to bind a specific port; resolves to that port if free, rejects
// otherwise. Used to validate a persisted port before spawning the
// Next server against it.
function tryBindPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        srv.close(() => resolve(addr.port));
      } else {
        srv.close(() => reject(new Error('Could not read server.address()')));
      }
    });
  });
}

// Pick a port for the local Next server, persisting the choice across
// runs.
//
// Why this matters: localStorage is keyed by origin (host:port). If we
// pick a fresh free port on every cold launch, every run gets a fresh
// localStorage — meaning the user's `gh_token` and `gh_user` cache
// vanish each time and they have to sign in again. Persisting the
// port stabilizes the origin and the cache survives.
//
// Strategy: read <userData>/picg-port. If present and the port is
// still free, reuse it. Otherwise pick a free port and persist it.
async function pickStablePort(): Promise<number> {
  const portFile = path.join(app.getPath('userData'), 'picg-port');
  try {
    const raw = await fs.readFile(portFile, 'utf-8');
    const stored = parseInt(raw.trim(), 10);
    if (Number.isFinite(stored) && stored > 0 && stored < 65536) {
      try {
        return await tryBindPort(stored);
      } catch {
        // Persisted port no longer free (another app grabbed it,
        // probably). Fall through and rebind.
      }
    }
  } catch {
    /* file missing on first run */
  }
  const fresh = await tryBindPort(0);
  try {
    await fs.mkdir(path.dirname(portFile), { recursive: true });
    await fs.writeFile(portFile, String(fresh), 'utf-8');
  } catch {
    /* non-fatal — we'll just pick again next launch */
  }
  return fresh;
}

// Poll a localhost URL until it responds with any HTTP status, or we time
// out. Used after spawning the Next server to know when we can loadURL.
async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Next server did not start within ${timeoutMs}ms`);
}

// Resolve to the URL we should loadURL: either dev or a packaged Next
// standalone server. The first call in packaged mode forks the
// standalone server; subsequent calls reuse the same URL (see
// cachedAppUrl above) so window-close + activate doesn't churn ports
// and lose localStorage.
async function resolveAppUrl(): Promise<string> {
  if (!app.isPackaged) return DEV_URL;

  // Reuse the running server if it's still alive. nextServer.killed
  // catches the case where we sent SIGTERM somewhere; nextServer.exitCode
  // catches a server that crashed on its own.
  if (
    cachedAppUrl &&
    nextServer &&
    !nextServer.killed &&
    nextServer.exitCode === null
  ) {
    return cachedAppUrl;
  }

  // electron-builder copies .next/standalone next to the app code; the
  // resourcesPath is the canonical location for asar-extra-resources
  // (we ship .next/standalone outside the asar so it can require its
  // bundled node_modules).
  const standaloneDir = path.join(process.resourcesPath, 'standalone');
  const serverScript = path.join(standaloneDir, 'server.js');
  if (!existsSync(serverScript)) {
    throw new Error(
      `Packaged Next standalone server.js missing at ${serverScript} — packaging is misconfigured.`
    );
  }

  const port = await pickStablePort();
  console.log(`[picg] spawning Next standalone server on port ${port}`);
  nextServer = fork(serverScript, [], {
    cwd: standaloneDir,
    // ELECTRON_RUN_AS_NODE makes Electron act like plain node — required
    // for fork() since Electron's binary doubles as both runtimes.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  nextServer.on('exit', (code, signal) => {
    console.log(`[picg] Next server exited code=${code} signal=${signal}`);
    // Server died — drop the cached URL so the next createWindow re-spawns
    // instead of trying to load a dead URL.
    cachedAppUrl = null;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);
  cachedAppUrl = `${baseUrl}/desktop/galleries`;
  return cachedAppUrl;
}

async function createWindow(): Promise<void> {
  const appUrl = await resolveAppUrl();
  console.log(`[picg] creating window, loading ${appUrl}`);
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'PicG',
    show: false, // show after first paint to avoid a white flash
    // macOS: keep the traffic lights, drop the system title bar so our
    // Topbar can paint up to the top edge. On Windows/Linux this falls
    // back to the platform default — cross-platform polish is a follow-up.
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox is intentionally OFF: a sandboxed preload can't `require()`
      // sibling modules (only `electron`, `events`, `timers`, `url`), which
      // breaks our split preload/contract files. contextIsolation +
      // nodeIntegration:false is the main security perimeter for the
      // renderer; bundling the preload to re-enable sandbox is a follow-up.
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Reload-with-cache-clear shortcut. Next 14 dev sometimes serves a stale
  // page.js whose webpack chunks have been replaced (`Cannot find module
  // './948.js'`); clearing the renderer HTTP cache before reloading is the
  // reliable way out. Default reload (Cmd+R) leaves cache; this shortcut
  // mirrors what a browser hard-reload does.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isHardReload =
      (input.meta || input.control) &&
      input.shift &&
      input.key.toLowerCase() === 'r';
    if (isHardReload) {
      event.preventDefault();
      win.webContents.session.clearCache().then(() => {
        win.webContents.reloadIgnoringCache();
      });
    }
    // Cmd/Ctrl+Opt+I → toggle DevTools, even in packaged builds.
    // Without this you'd need to relaunch from terminal with
    // PICG_DEVTOOLS=1 to inspect the renderer when something goes
    // wrong.
    const isDevToolsToggle =
      (input.meta || input.control) &&
      input.alt &&
      input.key.toLowerCase() === 'i';
    if (isDevToolsToggle) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[picg] failed to load ${url}: ${desc} (${code}). Is "npm run dev" running on :3000?`);
  });

  try {
    await win.loadURL(appUrl);
    console.log(`[picg] loaded ${appUrl}`);
  } catch (err) {
    console.error(`[picg] loadURL threw:`, err);
  }

  if (process.env.PICG_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

// Tell Chromium that picg:// is a "standard" scheme (parses host/path,
// supports fetch from the renderer, can be loaded as <img src> without
// CSP complaining). Must run before app.whenReady. Two distinct hosts
// share this scheme:
//   picg://oauth/...           → OAuth callback (delivered via OS,
//                                 not via fetch)
//   picg://gallery/<id>/<p>    → renderer fetches local gallery files
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'picg',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

// Structured error body for the picg:// handler. The renderer's
// useAdapterImage probes failed thumb URLs and rendrs the JSON
// `error` + `message` fields in the failure overlay; plain-text
// 404s used to fall through that parser and show as "picg:// 404".
function jsonError(
  status: number,
  payload: { error: string; message?: string; [k: string]: unknown }
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Picg-Error': '1',
    },
  });
}

function mimeForPath(p: string): string {
  const ext = p.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

// Single-instance lock: clicking a picg://oauth/... URL when PicG is
// already open should focus the existing window and forward the URL,
// not boot a second copy.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Register as default handler for picg://. In dev (electron run via
// `electron foo.js`) we have to pass argv so macOS associates the
// running binary, not the global electron one.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function deliverOAuthCallback(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return;
  let payload: OAuthCallbackPayload;
  try {
    // URL fragment carries the params; new URL() preserves the hash but
    // we have to strip the leading '#' and pass through URLSearchParams.
    const parsed = new URL(url);
    const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const params = new URLSearchParams(fragment);
    const error = params.get('oauth_error');
    const state = params.get('state') ?? '';
    if (error) {
      payload = { ok: false, error, state };
    } else {
      const token = params.get('oauth_token');
      const scope = params.get('oauth_scope') ?? '';
      if (!token) {
        payload = { ok: false, error: 'No oauth_token in callback', state };
      } else {
        payload = { ok: true, token, scope, state };
      }
    }
  } catch (err) {
    payload = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      state: '',
    };
  }

  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send(CHANNELS.auth.oauthCallback, payload);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    // No window yet — stash for when one comes up.
    pendingOAuthUrl = url;
  }
}

// macOS: protocol URLs come in as 'open-url' events.
app.on('open-url', (event, url) => {
  event.preventDefault();
  deliverOAuthCallback(url);
});

// Windows/Linux: protocol URLs are passed as command-line args to the
// second instance that the OS would otherwise have started; we get
// them here through the single-instance forwarding.
app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (url) deliverOAuthCallback(url);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  // Wipe HTTP cache on every cold launch so a Next dev rebuild that
  // changed chunk hashes can't strand us on a stale page.js.
  await session.defaultSession.clearCache();

  registerGalleryIpcHandlers();
  registerStorageIpcHandlers();
  registerCompressIpcHandlers();
  registerAuthIpcHandlers();
  initAutoUpdater();

  // OAuth IPC is small enough to inline rather than its own module.
  ipcMain.handle(CHANNELS.auth.openExternal, async (_e, url: string) => {
    await shell.openExternal(url);
  });

  // picg://gallery/<id>/<path> handler. Lets <img src="picg://..."> in the
  // renderer pull files straight from the on-disk clone without an IPC
  // round-trip + base64 re-encode through the StorageAdapter. The gallery
  // id is the manifest id (owner__repo); the path is whatever follows.
  //
  // Share the same GalleryRegistry as the IPC handlers (singleton from
  // ipc/gallery.ts). A separate instance here had its own manifest
  // cache that never saw galleries cloned after app startup, so every
  // picg:// fetch for a freshly-added gallery 404'd "Gallery not
  // found" until the next launch.
  const galleryRegistry = getRegistry();
  protocol.handle('picg', async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== 'gallery') {
      return jsonError(404, { error: 'not-picg-gallery', host: requestUrl.host });
    }
    const segments = requestUrl.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return jsonError(400, { error: 'bad-path', pathname: requestUrl.pathname });
    }
    const galleryId = decodeURIComponent(segments[0]);
    const relPath = segments
      .slice(1)
      .map((s) => decodeURIComponent(s))
      .join('/');

    const gallery = await galleryRegistry.resolve(galleryId);
    if (!gallery) {
      // Most common cause: a gallery cloned via IPC after a stale
      // protocol-side cache was read. We fixed that by sharing one
      // GalleryRegistry instance, but if it ever happens again the
      // structured body tells the renderer overlay which gallery id
      // failed to resolve.
      return jsonError(404, {
        error: 'gallery-not-found',
        galleryId,
        message: `No gallery in manifest with id "${galleryId}".`,
      });
    }

    // Resolve and confirm the resolved path stays inside gallery.localPath.
    // Same threat model as LocalGitStorageAdapter.absolute() — the
    // renderer (or any code building these URLs) should never be able to
    // read outside the gallery.
    const galleryRoot = path.resolve(gallery.localPath);
    const resolvedPath = path.resolve(galleryRoot, relPath);
    if (
      resolvedPath !== galleryRoot &&
      !resolvedPath.startsWith(galleryRoot + path.sep)
    ) {
      return new Response('Path escapes gallery', { status: 403 });
    }

    // ?thumb=512 → resize and serve a cached webp thumbnail at the
    // given target width. Used by the gallery overview cards so they
    // don't have to download + decode multi-MB originals just to fill
    // a 260 px square. Lightbox / album-page renderers omit the param
    // and get the original file.
    const thumbWidth = parseThumbWidth(requestUrl.searchParams.get('thumb'));

    try {
      if (thumbWidth) {
        try {
          const buf = await getOrCreateThumbnail(resolvedPath, thumbWidth);
          const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          return new Response(view, {
            status: 200,
            headers: {
              'Content-Type': 'image/webp',
              // Long cache: the URL changes when the source mtime changes
              // (key includes mtimeMs), so an immutable cache is safe.
              'Cache-Control': 'public, max-age=86400, immutable',
            },
          });
        } catch (thumbErr: any) {
          if (thumbErr?.code === 'ENOENT') throw thumbErr;
          // Don't silently fall back to the original — we want the
          // failure to be surfaceable. Log to stderr (Console.app
          // shows it under PicG) and return a structured error
          // response the renderer can read via fetch() to overlay on
          // the broken card.
          console.warn(
            `[picg] thumbnail failed: ${resolvedPath} @ ${thumbWidth}px:`,
            thumbErr?.stack ?? thumbErr?.message ?? thumbErr
          );
          const body = JSON.stringify({
            error: 'thumbnail-failed',
            path: relPath,
            width: thumbWidth,
            message: thumbErr?.message ?? String(thumbErr),
            code: thumbErr?.code,
          });
          return new Response(body, {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
              // Custom header so the renderer can spot a thumb failure
              // without parsing the body (handy for the <img onerror>
              // path where you only get a boolean).
              'X-Picg-Thumb-Error': '1',
            },
          });
        }
      }

      const data = await fs.readFile(resolvedPath);
      const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return new Response(view, {
        status: 200,
        headers: {
          'Content-Type': mimeForPath(resolvedPath),
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err: any) {
      // Structured body so the renderer's error overlay can show
      // something useful — most common reasons we hit this branch:
      //   - README.yml's `cover:` points to a file that doesn't exist
      //     locally (album rename without re-committing the cover, a
      //     partial git pull, an LFS pointer that wasn't fetched)
      //   - permissions on the gallery dir (rare)
      const isMissing = err?.code === 'ENOENT';
      const body = JSON.stringify({
        error: isMissing ? 'file-missing' : 'read-failed',
        path: relPath,
        message: err?.message ?? String(err),
        code: err?.code,
      });
      return new Response(body, {
        status: isMissing ? 404 : 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Picg-Error': '1',
        },
      });
    }
  });

  createWindow();

  // If the user clicked a picg:// link before the app was running, we
  // captured the URL but had nowhere to send it; now there's a window.
  if (pendingOAuthUrl) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      // Wait for the renderer to actually mount its listener before
      // delivering — otherwise the message lands on a dead webContents.
      win.webContents.once('did-finish-load', () => {
        if (pendingOAuthUrl) {
          deliverOAuthCallback(pendingOAuthUrl);
          pendingOAuthUrl = null;
        }
      });
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS apps typically stay alive after closing all windows; quitting
  // matches user expectation on Linux/Windows.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (nextServer && !nextServer.killed) {
    nextServer.kill('SIGTERM');
  }
});
