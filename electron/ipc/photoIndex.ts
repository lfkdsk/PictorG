// IPC handlers for the desktop-local photo index. The heavy lifting (file
// walk + EXIF extraction) lives in electron/photoIndex/; these handlers are
// thin wrappers that stream progress back to the requesting webContents.

import { ipcMain } from 'electron';

import {
  buildPhotoIndex,
  invalidateIndexCache,
  saveIndexDb,
} from '../photoIndex/indexer';
import { CHANNELS } from './contract';

export function registerPhotoIndexIpcHandlers(): void {
  ipcMain.handle(CHANNELS.photoIndex.build, async (event, galleryId: string) => {
    return buildPhotoIndex(galleryId, (progress) => {
      // Push to the same webContents that asked. Guarded: the renderer may
      // navigate away mid-build, destroying the contents.
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send(CHANNELS.photoIndex.progress, progress);
        }
      } catch {
        /* sender gone — ignore */
      }
    });
  });

  ipcMain.handle(
    CHANNELS.photoIndex.saveDb,
    async (_e, galleryId: string, bytes: Uint8Array, fingerprint: string) => {
      // IPC may hand us an ArrayBuffer-backed view or a Buffer; normalize.
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return saveIndexDb(galleryId, view, fingerprint);
    }
  );

  ipcMain.handle(
    CHANNELS.photoIndex.invalidate,
    async (_e, galleryId: string) => {
      await invalidateIndexCache(galleryId);
    }
  );
}
