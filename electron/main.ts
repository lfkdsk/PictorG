// Electron main process entry. Boots the BrowserWindow, registers IPC
// handlers, and wires the renderer to either the running Next dev server
// (PICG_DEV_URL, default http://localhost:3000) or — eventually — a packaged
// static export. Production packaging is out of scope for this spike.

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import * as path from 'node:path';

import { CHANNELS } from './ipc/contract';
import type { OAuthCallbackPayload } from './ipc/contract';
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

async function createWindow(): Promise<void> {
  console.log(`[picg] creating window, loading ${DEV_URL}`);
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
    await win.loadURL(DEV_URL);
    console.log(`[picg] loaded ${DEV_URL}`);
  } catch (err) {
    console.error(`[picg] loadURL threw:`, err);
  }

  if (process.env.PICG_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
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

  // OAuth IPC is small enough to inline rather than its own module.
  ipcMain.handle(CHANNELS.auth.openExternal, async (_e, url: string) => {
    await shell.openExternal(url);
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
