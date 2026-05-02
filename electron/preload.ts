// Preload script. Runs in an isolated context with both DOM and limited Node
// APIs, and uses contextBridge to expose a typed surface to the renderer.
// All file system, git, and gallery operations are routed through the main
// process.

import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS } from './ipc/contract';
import type { OAuthCallbackPayload, PicgBridge } from './ipc/contract';
import type { CloneProgress } from '../src/core/storage/electron/galleryTypes';

const bridge: PicgBridge = {
  pickGalleryDir: () => ipcRenderer.invoke(CHANNELS.pickGalleryDir),

  auth: {
    openExternal: (url) => ipcRenderer.invoke(CHANNELS.auth.openExternal, url),
    onOAuthCallback: (handler: (payload: OAuthCallbackPayload) => void) => {
      const listener = (_e: unknown, payload: OAuthCallbackPayload) => handler(payload);
      ipcRenderer.on(CHANNELS.auth.oauthCallback, listener);
      return () => ipcRenderer.off(CHANNELS.auth.oauthCallback, listener);
    },
    saveToken: (token) => ipcRenderer.invoke(CHANNELS.auth.saveToken, token),
    getToken: () => ipcRenderer.invoke(CHANNELS.auth.getToken),
    clearToken: () => ipcRenderer.invoke(CHANNELS.auth.clearToken),
  },

  compress: {
    image: (request) => ipcRenderer.invoke(CHANNELS.compress.image, request),
  },

  gallery: {
    list: () => ipcRenderer.invoke(CHANNELS.gallery.list),
    resolve: (id) => ipcRenderer.invoke(CHANNELS.gallery.resolve, id),
    clone: (...args) => ipcRenderer.invoke(CHANNELS.gallery.clone, ...args),
    remove: (id) => ipcRenderer.invoke(CHANNELS.gallery.remove, id),
    sync: (id) => ipcRenderer.invoke(CHANNELS.gallery.sync, id),
    push: (id) => ipcRenderer.invoke(CHANNELS.gallery.push, id),
    status: (id) => ipcRenderer.invoke(CHANNELS.gallery.status, id),
    onCloneProgress: (handler: (event: CloneProgress) => void) => {
      const listener = (_e: unknown, evt: CloneProgress) => handler(evt);
      ipcRenderer.on(CHANNELS.gallery.cloneProgress, listener);
      return () => ipcRenderer.off(CHANNELS.gallery.cloneProgress, listener);
    },
  },

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
