// Click-to-download, click-to-restart update flow.
//
// Detection is automatic (initial check + 4 h poll against
// latest-mac.yml / latest.yml on the GitHub release), but nothing
// downloads until the user clicks the topbar pill: updates run to
// hundreds of MB and quietly saturating a metered connection is worse
// than asking. After downloadUpdate resolves the pill flips to
// "Restart to update" → quitAndInstall. If the user quits without
// clicking, autoInstallOnAppQuit applies the downloaded update on the
// way out.
//
// macOS silent install (Squirrel.Mac) only works because builds are
// Developer ID signed + notarized from v1.3.7 on — Squirrel refuses to
// swap in a .app whose code-signature team differs from the running
// binary's, which is also why the signing identity must never change
// between releases (see docs/desktop-development.md §8.2). It consumes
// the zip artifact from latest-mac.yml, not the DMG; users on ≤1.3.6
// run the old notify-only build and take the browser path one last
// time. Windows (NSIS) has no signature gate and just works.
//
// openReleasePage survives as the fallback CTA when a download fails
// (network, or a release missing its zip).
//
// Skipped on dev (`!app.isPackaged`).

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import semver from 'semver';

import { CHANNELS } from './ipc/contract';

function log(...parts: unknown[]): void {
  console.log('[picg updater]', ...parts);
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

// Owner/repo for the GitHub release page we send the user to. Must
// match electron-builder.yml's publish target. Hardcoded rather than
// read out of electron-updater's private state — it only changes
// when the publish target changes.
const RELEASE_PAGE_URL =
  'https://github.com/lfkdsk/PictorG/releases/latest';

// Module-level cache of the most recent "available" event. Replayed to
// any renderer that mounts a listener AFTER the broadcast already
// fired — without this, the Topbar pill silently misses an update if
// the user happened to be navigating between pages at the moment
// the check completed.
let pendingAvailableUpdate: { version: string; releaseUrl: string } | null = null;

// Set once update-downloaded fires. Replayed via getPending alongside
// the available-update cache so a freshly-mounted Topbar renders
// "Restart to update" instead of re-offering the download.
let downloadedUpdate: { version: string } | null = null;

// Most recent updater error message + ISO timestamp. Surfaced via
// checkNow's response so the avatar-menu manual check can tell the
// user "last attempt failed N min ago because X".
let lastUpdateError: { message: string; at: string } | null = null;

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    log('updater: skipped (dev mode)');
    return;
  }

  autoUpdater.logger = {
    info: (m: unknown) => log('updater info', m),
    warn: (m: unknown) => log('updater warn', m),
    error: (m: unknown) => log('updater error', m),
    debug: (m: unknown) => log('updater debug', m),
  } as any;

  // Download only on explicit user click (see header). Once a download
  // HAS happened, install it on quit even if the user never clicks
  // "Restart to update" — the work is already on disk.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const version = info?.version;
    if (!version) return;
    log('update-available', version);
    pendingAvailableUpdate = { version, releaseUrl: RELEASE_PAGE_URL };
    broadcastChan(CHANNELS.updater.updateAvailable, pendingAvailableUpdate);
  });
  autoUpdater.on('download-progress', (p) => {
    broadcastChan(CHANNELS.updater.downloadProgress, {
      percent: Math.round(p?.percent ?? 0),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version ?? pendingAvailableUpdate?.version ?? '';
    log('update-downloaded', version);
    downloadedUpdate = { version };
    broadcastChan(CHANNELS.updater.updateDownloaded, downloadedUpdate);
  });
  autoUpdater.on('update-not-available', () => {
    log('update-not-available');
  });
  autoUpdater.on('error', (err) => {
    const message = err?.message ?? String(err);
    log('updater error', message);
    lastUpdateError = { message, at: new Date().toISOString() };
    broadcastChan(CHANNELS.updater.updateError, { message });
  });

  // Renderer asks main to open the GitHub release page in the user's
  // default browser. URL is fixed (not passed by the renderer) so an
  // injected payload can't redirect users somewhere else.
  ipcMain.handle(CHANNELS.updater.openReleasePage, async () => {
    await shell.openExternal(RELEASE_PAGE_URL);
  });

  // Topbar mount-time replay: "is there already an available update I
  // missed?" If we have a cached event, the pill shows immediately
  // without waiting for the next broadcast. `downloaded` distinguishes
  // "offer the download" from "offer the restart" after a remount.
  ipcMain.handle(CHANNELS.updater.getPending, () =>
    pendingAvailableUpdate
      ? { ...pendingAvailableUpdate, downloaded: downloadedUpdate != null }
      : null
  );

  // One download at a time; a second click while in flight just awaits
  // the same download. Rejections propagate to the renderer's invoke,
  // which falls back to the release page.
  let inFlightDownload: Promise<unknown> | null = null;
  ipcMain.handle(CHANNELS.updater.downloadUpdate, async () => {
    if (downloadedUpdate) return;
    if (!inFlightDownload) {
      inFlightDownload = autoUpdater.downloadUpdate().finally(() => {
        inFlightDownload = null;
      });
    }
    await inFlightDownload;
  });

  ipcMain.handle(CHANNELS.updater.quitAndInstall, () => {
    log('quitAndInstall');
    autoUpdater.quitAndInstall();
  });

  // Manual check trigger from the avatar menu — useful when you want
  // to verify the update plumbing without waiting for the 4 h poll.
  //
  // checkForUpdates() resolves to the manifest version (whatever's on
  // the GitHub release), regardless of whether it differs from the
  // running app. Compare against app.getVersion() ourselves.
  ipcMain.handle(CHANNELS.updater.checkNow, async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      const manifestVersion = r?.updateInfo?.version ?? null;
      const currentVersion = app.getVersion();
      // Semver-aware: an update is "available" only when the manifest
      // version is strictly greater than the running version. The
      // earlier `manifestVersion !== currentVersion` check announced
      // downgrades as updates — a real failure mode when GitHub's
      // "latest release" auto-detection trails behind us.
      const updateAvailable =
        manifestVersion != null &&
        semver.valid(manifestVersion) != null &&
        semver.valid(currentVersion) != null &&
        semver.gt(manifestVersion, currentVersion);
      return {
        ok: true as const,
        currentVersion,
        manifestVersion,
        updateAvailable,
        // Already-cached available update? Renderer can show the pill
        // without waiting for the broadcast on the next event.
        available: pendingAvailableUpdate,
        releaseUrl: RELEASE_PAGE_URL,
        lastError: lastUpdateError,
      };
    } catch (err: any) {
      return { ok: false as const, error: err?.message ?? String(err) };
    }
  });

  // Initial check + recurring poll. checkForUpdatesAndNotify shows a
  // native notification on completion which we don't want — the
  // renderer pill is the only surface.
  autoUpdater.checkForUpdates().catch((err) => {
    log('updater initial check failed', err?.message ?? String(err));
  });
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log('updater poll failed', err?.message ?? String(err));
    });
  }, FOUR_HOURS);
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
