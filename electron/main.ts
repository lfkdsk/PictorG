// Electron main process entry. Boots the BrowserWindow, registers IPC
// handlers, and wires the renderer to either the running Next dev server
// (PICG_DEV_URL, default http://localhost:3000) or — eventually — a packaged
// static export. Production packaging is out of scope for this spike.

import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';

import { registerStorageIpcHandlers } from './ipc/storage';

const DEV_URL = process.env.PICG_DEV_URL ?? 'http://localhost:3000';

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'PicG',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await win.loadURL(DEV_URL);

  if (process.env.PICG_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
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
