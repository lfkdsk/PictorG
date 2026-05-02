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

import { logToFile } from './log';
import { initAutoUpdater } from './updater';
process.on('uncaughtException', (err) => {
  logToFile('uncaughtException', err?.stack ?? String(err));
});
process.on('unhandledRejection', (reason) => {
  logToFile('unhandledRejection', reason instanceof Error ? reason.stack : String(reason));
});
logToFile('main.ts boot', {
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  execPath: process.execPath,
  cwd: process.cwd(),
});

import { GalleryRegistry } from './galleries/GalleryRegistry';

import { CHANNELS } from './ipc/contract';
import type { OAuthCallbackPayload } from './ipc/contract';
import { registerAuthIpcHandlers } from './ipc/auth';
import { registerCompressIpcHandlers } from './ipc/compress';
import { registerGalleryIpcHandlers } from './ipc/gallery';
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

// Find a free localhost port by binding 0 and reading what the OS hands
// us back. Used in packaged mode to avoid hard-coding a port that might
// already be in use.
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not get port from server.address()')));
      }
    });
  });
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

// Resolve to the URL we should loadURL: either dev or a freshly-spawned
// packaged Next standalone server.
async function resolveAppUrl(): Promise<string> {
  if (!app.isPackaged) return DEV_URL;

  // electron-builder copies .next/standalone next to the app code; the
  // resourcesPath is the canonical location for asar-extra-resources
  // (we ship .next/standalone outside the asar so it can require its
  // bundled node_modules).
  const standaloneDir = path.join(process.resourcesPath, 'standalone');
  const serverScript = path.join(standaloneDir, 'server.js');
  logToFile('resolveAppUrl', { standaloneDir, serverScript, exists: existsSync(serverScript) });

  const port = await findFreePort();
  logToFile(`spawning Next standalone server on port ${port}`);
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
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);
  return `${baseUrl}/desktop/galleries`;
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
  const galleryRegistry = new GalleryRegistry();
  protocol.handle('picg', async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== 'gallery') {
      // OAuth callbacks come in via the OS-level open-url event, not fetch.
      // Anything else under picg:// gets a 404 from this handler.
      return new Response('Not found', { status: 404 });
    }
    const segments = requestUrl.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return new Response('Bad path', { status: 400 });
    }
    const galleryId = decodeURIComponent(segments[0]);
    const relPath = segments
      .slice(1)
      .map((s) => decodeURIComponent(s))
      .join('/');

    const gallery = await galleryRegistry.resolve(galleryId);
    if (!gallery) {
      return new Response('Gallery not found', { status: 404 });
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

    try {
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
      if (err?.code === 'ENOENT') {
        return new Response('Not found', { status: 404 });
      }
      return new Response(`Read error: ${err?.message ?? err}`, { status: 500 });
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
