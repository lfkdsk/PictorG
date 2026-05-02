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

import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

import { CHANNELS } from './ipc/contract';

function log(...parts: unknown[]): void {
  console.log('[picg updater]', ...parts);
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

// Module-level cache of the most recent "downloaded" event. Replayed to
// any renderer that mounts a listener AFTER the broadcast already
// fired — without this, the Topbar pill silently misses an update if
// the user happened to be navigating between pages at the moment
// download finished.
let pendingDownloadedUpdate: { version?: string } | null = null;

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    log('updater: skipped (dev mode)');
    return;
  }

  // Pipe electron-updater's own logs through our debug-log file. Helps
  // triage "user reports they didn't get an update" without asking
  // them to open a terminal.
  autoUpdater.logger = {
    info: (m: unknown) => log('updater info', m),
    warn: (m: unknown) => log('updater warn', m),
    error: (m: unknown) => log('updater error', m),
    debug: (m: unknown) => log('updater debug', m),
  } as any;

  // Don't auto-restart mid-session. We download in the background but
  // wait until the user quits (or explicitly clicks Install) to swap
  // the binary — restarting unprompted would lose any in-progress
  // album edit.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    log('update-available', info?.version);
    broadcast('update-available', { version: info?.version });
  });
  autoUpdater.on('update-not-available', () => {
    log('update-not-available');
  });
  autoUpdater.on('download-progress', (progress) => {
    broadcast('update-download-progress', {
      percent: Math.round(progress?.percent ?? 0),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log('update-downloaded', info?.version);
    pendingDownloadedUpdate = { version: info?.version };
    broadcastChan(CHANNELS.updater.updateDownloaded, pendingDownloadedUpdate);
  });

  // Renderer-driven "Install now" — quitAndInstall closes all windows,
  // exits the app, and re-launches into the new version. We don't
  // hook this onto Cmd+Q because autoInstallOnAppQuit already covers
  // the lazy path (next normal quit installs).
  ipcMain.handle(CHANNELS.updater.installNow, () => {
    autoUpdater.quitAndInstall();
  });

  // Renderer query: "is there already a downloaded update I missed?"
  // Topbar calls this on mount; if we have a cached event, the pill
  // shows immediately without waiting for the next broadcast.
  ipcMain.handle(CHANNELS.updater.getPending, () => pendingDownloadedUpdate);

  // Manual check trigger from the avatar menu — useful when you want
  // to verify update plumbing without waiting for the 4 h poll. Just
  // re-runs the same checkForUpdates() the boot path uses; resolves
  // to whatever electron-updater reports.
  ipcMain.handle(CHANNELS.updater.checkNow, async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        version: r?.updateInfo?.version,
      };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  autoUpdater.on('error', (err) => {
    log('updater error', err?.message ?? String(err));
  });

  // Initial check + a recurring poll. checkForUpdatesAndNotify shows
  // a native notification on completion, which we don't want; use the
  // bare check instead.
  autoUpdater.checkForUpdates().catch((err) => {
    log('updater initial check failed', err?.message ?? String(err));
  });
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log('updater poll failed', err?.message ?? String(err));
    });
  }, FOUR_HOURS);
}

function broadcast(suffix: string, payload: unknown): void {
  // Legacy helper for the progress / available events we don't yet wire
  // through the renderer. Kept the namespaced name (updater:*) so the
  // log output is readable.
  broadcastChan(`updater:${suffix}`, payload);
}

function broadcastChan(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* renderer may be gone */
    }
  }
}
