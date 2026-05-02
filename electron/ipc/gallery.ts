// IPC handlers for the App-managed gallery library. Renderer drives the
// flow (list → user picks "Add" → renderer calls clone with token+repo info)
// and main does the on-disk work via GalleryRegistry. Clone is the only
// long-running call; it pushes progress events back to the requesting
// webContents on CHANNELS.gallery.cloneProgress.

import { ipcMain } from 'electron';

import { GalleryRegistry } from '../galleries/GalleryRegistry';
import { CHANNELS } from './contract';
import type { GalleryCloneArgs, GalleryMigrateArgs } from './contract';

// Module-level singleton, exported so the picg:// protocol handler in
// main.ts can use the SAME instance (and therefore the same cache).
// Previously main.ts did `new GalleryRegistry()` itself — a separate
// instance whose cache never saw galleries cloned later by the IPC
// path. The picg:// protocol handler then 404'd every cover for any
// gallery cloned after app startup.
let registry: GalleryRegistry | null = null;

export function getRegistry(): GalleryRegistry {
  if (!registry) registry = new GalleryRegistry();
  return registry;
}

export function registerGalleryIpcHandlers(): void {
  ipcMain.handle(CHANNELS.gallery.list, async () => {
    return getRegistry().list();
  });

  ipcMain.handle(CHANNELS.gallery.listInFlight, async () => {
    return getRegistry().listInFlight();
  });

  ipcMain.handle(CHANNELS.gallery.resolve, async (_e, id: string) => {
    return getRegistry().resolve(id);
  });

  ipcMain.handle(
    CHANNELS.gallery.clone,
    async (event, ...args: GalleryCloneArgs) => {
      const [request] = args;
      return getRegistry().clone(request, event.sender);
    }
  );

  ipcMain.handle(CHANNELS.gallery.remove, async (_e, id: string) => {
    await getRegistry().remove(id);
  });

  ipcMain.handle(CHANNELS.gallery.sync, async (_e, id: string) => {
    return getRegistry().sync(id);
  });

  ipcMain.handle(CHANNELS.gallery.push, async (_e, id: string) => {
    await getRegistry().push(id);
  });

  ipcMain.handle(CHANNELS.gallery.status, async (_e, id: string) => {
    return getRegistry().status(id);
  });

  ipcMain.handle(CHANNELS.gallery.undoLastCommit, async (_e, id: string) => {
    return getRegistry().undoLastCommit(id);
  });

  // Migration is the only gallery op besides clone that streams progress.
  // We pass `event.sender` so the registry can broadcast
  // CHANNELS.gallery.migrateProgress events back to the requesting
  // renderer, exactly matching the clone-progress pattern.
  ipcMain.handle(
    CHANNELS.gallery.migrate,
    async (event, ...args: GalleryMigrateArgs) => {
      const [id, direction] = args;
      const registry = getRegistry();
      return direction === 'to-icloud'
        ? registry.migrateToICloud(id, event.sender)
        : registry.migrateToInternal(id, event.sender);
    }
  );

  ipcMain.handle(CHANNELS.gallery.discover, async () => {
    return getRegistry().discoverICloud();
  });

  // Renderer-visible iCloud root path. The galleries page uses this
  // for the "iCloud-syncing libraries live in <path>" hint in the
  // settings menu, so the user can find them in Finder if they need to.
  ipcMain.handle(CHANNELS.gallery.iCloudRoot, async () => {
    return getRegistry().iCloudGalleriesRoot();
  });
}
