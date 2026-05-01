// Electron main process entry. Boots the BrowserWindow, registers IPC
// handlers, and wires the renderer to either the running Next dev server
// (PICG_DEV_URL, default http://localhost:3000) or — eventually — a packaged
// static export. Production packaging is out of scope for this spike.

import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';

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

app.whenReady().then(() => {
  registerGalleryIpcHandlers();
  registerStorageIpcHandlers();
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
