// Shared main-side broadcasters for IPC events that aren't tied to
// a specific request/response cycle.
//
// Why a separate module: storage.ts and gallery.ts both want to fire
// `gallery.changed` after a mutation, and both need the same
// "broadcast to every BrowserWindow" semantics. Inlining the broadcast
// in each handler would (a) duplicate the BrowserWindow loop and (b)
// scatter the channel-name dependency across multiple files.

import { BrowserWindow } from 'electron';

import { CHANNELS } from './contract';
import type { GalleryChangedEvent } from './contract';

// Fan a `gallery.changed` event out to every open BrowserWindow.
//
// We send to all windows rather than just the originating sender
// because:
//   * single-window today, multi-window plausibly later — futureproof
//   * a single webContents may host multiple gallery pages over its
//     lifetime; the page-level subscriber filters on galleryId/repoPath
//     anyway, so over-broadcasting is cheap and never wrong
//
// `webContents.send` does no work if the listener was already
// unregistered (the channel just has no handlers), so dead windows
// don't bleed errors.
export function emitGalleryChanged(payload: GalleryChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(CHANNELS.gallery.changed, payload);
    } catch {
      /* destroyed mid-iteration — ignore */
    }
  }
}
