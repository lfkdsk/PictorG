// Preload script. Runs in an isolated context with both DOM and limited Node
// APIs, and uses contextBridge to expose a typed surface to the renderer.
// All file system, git, and gallery operations are routed through the main
// process.

import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS } from './ipc/contract';
import type {
  GalleryChangedEvent,
  OAuthCallbackPayload,
  PicgBridge,
} from './ipc/contract';
import type {
  CloneProgress,
  MigrateProgress,
} from '../src/core/storage/electron/galleryTypes';

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

  updater: {
    installNow: () => ipcRenderer.invoke(CHANNELS.updater.installNow),
    onUpdateAvailable: (handler) => {
      const listener = (_e: unknown, payload: { version?: string }) =>
        handler(payload);
      ipcRenderer.on(CHANNELS.updater.updateAvailable, listener);
      return () => ipcRenderer.off(CHANNELS.updater.updateAvailable, listener);
    },
    onUpdateDownloaded: (handler) => {
      const listener = (_e: unknown, payload: { version?: string }) =>
        handler(payload);
      ipcRenderer.on(CHANNELS.updater.updateDownloaded, listener);
      return () => ipcRenderer.off(CHANNELS.updater.updateDownloaded, listener);
    },
    onDownloadProgress: (handler) => {
      const listener = (_e: unknown, payload: { percent: number }) =>
        handler(payload);
      ipcRenderer.on(CHANNELS.updater.downloadProgress, listener);
      return () => ipcRenderer.off(CHANNELS.updater.downloadProgress, listener);
    },
    onUpdateError: (handler) => {
      const listener = (_e: unknown, payload: { message: string }) =>
        handler(payload);
      ipcRenderer.on(CHANNELS.updater.updateError, listener);
      return () => ipcRenderer.off(CHANNELS.updater.updateError, listener);
    },
    getPending: () => ipcRenderer.invoke(CHANNELS.updater.getPending),
    checkNow: () => ipcRenderer.invoke(CHANNELS.updater.checkNow),
  },

  gallery: {
    list: () => ipcRenderer.invoke(CHANNELS.gallery.list),
    listInFlight: () => ipcRenderer.invoke(CHANNELS.gallery.listInFlight),
    resolve: (id) => ipcRenderer.invoke(CHANNELS.gallery.resolve, id),
    clone: (...args) => ipcRenderer.invoke(CHANNELS.gallery.clone, ...args),
    cancelClone: (id) => ipcRenderer.invoke(CHANNELS.gallery.cancelClone, id),
    remove: (id) => ipcRenderer.invoke(CHANNELS.gallery.remove, id),
    sync: (id) => ipcRenderer.invoke(CHANNELS.gallery.sync, id),
    push: (id) => ipcRenderer.invoke(CHANNELS.gallery.push, id),
    status: (id) => ipcRenderer.invoke(CHANNELS.gallery.status, id),
    undoLastCommit: (id) =>
      ipcRenderer.invoke(CHANNELS.gallery.undoLastCommit, id),
    onCloneProgress: (handler: (event: CloneProgress) => void) => {
      const listener = (_e: unknown, evt: CloneProgress) => handler(evt);
      ipcRenderer.on(CHANNELS.gallery.cloneProgress, listener);
      return () => ipcRenderer.off(CHANNELS.gallery.cloneProgress, listener);
    },
    migrate: (...args) => ipcRenderer.invoke(CHANNELS.gallery.migrate, ...args),
    discover: () => ipcRenderer.invoke(CHANNELS.gallery.discover),
    iCloudRoot: () => ipcRenderer.invoke(CHANNELS.gallery.iCloudRoot),
    onMigrateProgress: (handler: (event: MigrateProgress) => void) => {
      const listener = (_e: unknown, evt: MigrateProgress) => handler(evt);
      ipcRenderer.on(CHANNELS.gallery.migrateProgress, listener);
      return () => ipcRenderer.off(CHANNELS.gallery.migrateProgress, listener);
    },
    onChanged: (handler: (event: GalleryChangedEvent) => void) => {
      const listener = (_e: unknown, evt: GalleryChangedEvent) => handler(evt);
      ipcRenderer.on(CHANNELS.gallery.changed, listener);
      return () => ipcRenderer.off(CHANNELS.gallery.changed, listener);
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
