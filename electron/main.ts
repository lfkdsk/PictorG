// Electron main process entry. Boots the BrowserWindow, registers IPC
// handlers, and wires the renderer to either the running Next dev server
// (PICG_DEV_URL, default http://localhost:3000) or — eventually — a packaged
// static export. Production packaging is out of scope for this spike.

import { app, BrowserWindow, session } from 'electron';
import * as path from 'node:path';

import { registerCompressIpcHandlers } from './ipc/compress';
import { registerGalleryIpcHandlers } from './ipc/gallery';
import { registerStorageIpcHandlers } from './ipc/storage';

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

app.whenReady().then(async () => {
  // Wipe HTTP cache on every cold launch so a Next dev rebuild that
  // changed chunk hashes can't strand us on a stale page.js.
  await session.defaultSession.clearCache();

  registerGalleryIpcHandlers();
  registerStorageIpcHandlers();
  registerCompressIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS apps typically stay alive after closing all windows; quitting
  // matches user expectation on Linux/Windows.
  if (process.platform !== 'darwin') app.quit();
});
