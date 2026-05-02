// IPC handlers exposing LocalGitStorageAdapter to the renderer. Each handler
// instantiates a fresh adapter for the given repoPath — adapters are cheap
// and stateless beyond their config, so caching isn't worth the bookkeeping
// here.

import { dialog, ipcMain, BrowserWindow } from 'electron';

import { LocalGitStorageAdapter } from '../storage/LocalGitStorageAdapter';
import { CHANNELS } from './contract';
import type {
  StorageBatchWriteFilesArgs,
  StorageDeleteDirectoryArgs,
  StorageDeleteFileArgs,
  StorageDeleteFilesArgs,
  StorageListDirectoryArgs,
  StorageReadFileArgs,
  StorageReadFileMetadataArgs,
  StorageWriteFileArgs,
  WireFileContent,
} from './contract';

// Spike default: don't push automatically. Real auto-push behaviour will be a
// product decision once the desktop UX has a "Publish" affordance; for now
// keeping it off means the e2e smoke test works without remote/credentials
// configured. Override with PICG_AUTOPUSH=1.
const AUTO_PUSH = process.env.PICG_AUTOPUSH === '1';

function adapterFor(repoPath: string): LocalGitStorageAdapter {
  return new LocalGitStorageAdapter({ repoPath, autoPush: AUTO_PUSH });
}

export function registerStorageIpcHandlers(): void {
  ipcMain.handle(CHANNELS.pickGalleryDir, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined as any, {
      title: 'Pick a local gallery directory',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.storage.getDefaultBranch, async (_e, repoPath: string) => {
    return adapterFor(repoPath).getDefaultBranch();
  });

  ipcMain.handle(
    CHANNELS.storage.listDirectory,
    async (_e, ...args: StorageListDirectoryArgs) => {
      const [repoPath, p, options] = args;
      return adapterFor(repoPath).listDirectory(p, options);
    }
  );

  ipcMain.handle(
    CHANNELS.storage.readFile,
    async (_e, ...args: StorageReadFileArgs): Promise<WireFileContent> => {
      const [repoPath, p, options] = args;
      const file = await adapterFor(repoPath).readFile(p, options);
      return { data: file.data, sha: file.sha };
    }
  );

  ipcMain.handle(
    CHANNELS.storage.readFileMetadata,
    async (_e, ...args: StorageReadFileMetadataArgs) => {
      const [repoPath, p, options] = args;
      return adapterFor(repoPath).readFileMetadata(p, options);
    }
  );

  ipcMain.handle(
    CHANNELS.storage.writeFile,
    async (_e, ...args: StorageWriteFileArgs) => {
      const [repoPath, p, content, message, options] = args;
      await adapterFor(repoPath).writeFile(p, content, message, options);
    }
  );

  ipcMain.handle(
    CHANNELS.storage.batchWriteFiles,
    async (_e, ...args: StorageBatchWriteFilesArgs) => {
      const [repoPath, files, message, options] = args;
      await adapterFor(repoPath).batchWriteFiles(files, message, options);
    }
  );

  ipcMain.handle(
    CHANNELS.storage.deleteFile,
    async (_e, ...args: StorageDeleteFileArgs) => {
      const [repoPath, p, message, options] = args;
      await adapterFor(repoPath).deleteFile(p, message, options);
    }
  );

  ipcMain.handle(
    CHANNELS.storage.deleteFiles,
    async (_e, ...args: StorageDeleteFilesArgs) => {
      const [repoPath, paths, message, options] = args;
      await adapterFor(repoPath).deleteFiles(paths, message, options);
    }
  );

  ipcMain.handle(
    CHANNELS.storage.deleteDirectory,
    async (_e, ...args: StorageDeleteDirectoryArgs) => {
      const [repoPath, dirPath, message, options] = args;
      await adapterFor(repoPath).deleteDirectory(dirPath, message, options);
    }
  );
}
