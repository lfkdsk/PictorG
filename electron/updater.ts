// Notify-only update flow.
//
// We don't run electron-updater's silent download / Squirrel.Mac
// install path: the app is ad-hoc signed (no Apple Developer cert),
// and Squirrel.Mac refuses to swap a .app whose code-signature team
// doesn't match the running binary. Even if we shipped the .zip
// artifact electron-updater wants on macOS, the install step would
// still fail — and the failure is invisible to the renderer.
//
// Instead: keep electron-updater for the cheap part (parse
// latest-mac.yml off the GitHub release, semver-compare against
// app.getVersion()), and when an update exists, surface a "vX.Y.Z
// available — Download" pill in the topbar. Click → opens the
// GitHub release page in the user's browser; they grab the new DMG
// and replace /Applications/PicG.app the same way they did the first
// install. Same flow Fix-Gatekeeper.command was designed around.
//
// We can revisit silent updates once the app is properly signed +
// notarized; until then this is the only channel that actually
// works for unsigned macOS builds.
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

  // Notify-only: we never let electron-updater download or install.
  // The "Download" CTA in the renderer opens the release page in the
  // browser instead.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    const version = info?.version;
    if (!version) return;
    log('update-available', version);
    pendingAvailableUpdate = { version, releaseUrl: RELEASE_PAGE_URL };
    broadcastChan(CHANNELS.updater.updateAvailable, pendingAvailableUpdate);
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
  // without waiting for the next broadcast.
  ipcMain.handle(CHANNELS.updater.getPending, () => pendingAvailableUpdate);

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
