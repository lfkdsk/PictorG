// Auto-update wiring against electron-updater. The publish target is
// configured in electron-builder.yml (provider: github, owner: lfkdsk,
// repo: PicG); electron-updater reads the matching `latest-mac.yml`
// off the GitHub release on launch, compares versions, and downloads
// the newer .dmg in the background.
//
// Behavior we want:
//   - Check on startup, then every 4h while the app is running.
//   - Download silently. Surface "ready to install" via a Topbar
//     affordance later; for now log + IPC channel for the renderer
//     to pick up if it wants to show a banner.
//   - User-initiated install on app quit (auto-installer triggers a
//     restart, which is jarring mid-edit — defer to next quit).
//
// Skipped on dev (`!app.isPackaged`) — no asar to swap, and the dev
// channel doesn't have a GitHub release tied to it.

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

import { logToFile } from './log';

const FOUR_HOURS = 4 * 60 * 60 * 1000;

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    logToFile('updater: skipped (dev mode)');
    return;
  }

  // Pipe electron-updater's own logs through our debug-log file. Helps
  // triage "user reports they didn't get an update" without asking
  // them to open a terminal.
  autoUpdater.logger = {
    info: (m: unknown) => logToFile('updater info', m),
    warn: (m: unknown) => logToFile('updater warn', m),
    error: (m: unknown) => logToFile('updater error', m),
    debug: (m: unknown) => logToFile('updater debug', m),
  } as any;

  // Don't auto-restart mid-session. We download in the background but
  // wait until the user quits (or explicitly clicks Install) to swap
  // the binary — restarting unprompted would lose any in-progress
  // album edit.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    logToFile('update-available', info?.version);
    broadcast('update-available', { version: info?.version });
  });
  autoUpdater.on('update-not-available', () => {
    logToFile('update-not-available');
  });
  autoUpdater.on('download-progress', (progress) => {
    broadcast('update-download-progress', {
      percent: Math.round(progress?.percent ?? 0),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    logToFile('update-downloaded', info?.version);
    broadcast('update-downloaded', { version: info?.version });
  });
  autoUpdater.on('error', (err) => {
    logToFile('updater error', err?.message ?? String(err));
  });

  // Initial check + a recurring poll. checkForUpdatesAndNotify shows
  // a native notification on completion, which we don't want; use the
  // bare check instead.
  autoUpdater.checkForUpdates().catch((err) => {
    logToFile('updater initial check failed', err?.message ?? String(err));
  });
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logToFile('updater poll failed', err?.message ?? String(err));
    });
  }, FOUR_HOURS);
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(`updater:${channel}`, payload);
    } catch {
      /* renderer may be gone */
    }
  }
}
