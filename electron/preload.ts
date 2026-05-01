// Preload script. Runs in an isolated context with both DOM and limited Node
// APIs, and uses contextBridge to expose a typed surface to the renderer.
// All file system and git operations are routed through the main process.

import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS } from './ipc/contract';
import type { PicgBridge } from './ipc/contract';

const bridge: PicgBridge = {
  pickGalleryDir: () => ipcRenderer.invoke(CHANNELS.pickGalleryDir),
  storage: {
    getDefaultBranch: (repoPath) =>
      ipcRenderer.invoke(CHANNELS.storage.getDefaultBranch, repoPath),
    listDirectory: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.listDirectory, ...args),
    readFile: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.readFile, ...args),
    readFileMetadata: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.readFileMetadata, ...args),
    writeFile: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.writeFile, ...args),
    batchWriteFiles: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.batchWriteFiles, ...args),
    deleteFile: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.deleteFile, ...args),
    deleteFiles: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.deleteFiles, ...args),
    deleteDirectory: (...args) =>
      ipcRenderer.invoke(CHANNELS.storage.deleteDirectory, ...args),
  },
};

contextBridge.exposeInMainWorld('picgBridge', bridge);
