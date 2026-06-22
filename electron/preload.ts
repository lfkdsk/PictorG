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
  PhotoIndexProgress,
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
    preview: (request) => ipcRenderer.invoke(CHANNELS.compress.preview, request),
  },

  updater: {
    openReleasePage: () =>
      ipcRenderer.invoke(CHANNELS.updater.openReleasePage),
    onUpdateAvailable: (handler) => {
      const listener = (
        _e: unknown,
        payload: { version: string; releaseUrl: string }
      ) => handler(payload);
      ipcRenderer.on(CHANNELS.updater.updateAvailable, listener);
      return () => ipcRenderer.off(CHANNELS.updater.updateAvailable, listener);
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
    openFolder: (id) => ipcRenderer.invoke(CHANNELS.gallery.openFolder, id),
    sync: (id) => ipcRenderer.invoke(CHANNELS.gallery.sync, id),
    push: (id) => ipcRenderer.invoke(CHANNELS.gallery.push, id),
    unpushedCommits: (id) =>
      ipcRenderer.invoke(CHANNELS.gallery.unpushedCommits, id),
    status: (id) => ipcRenderer.invoke(CHANNELS.gallery.status, id),
    refreshStatus: (id) =>
      ipcRenderer.invoke(CHANNELS.gallery.refreshStatus, id),
    undoLastCommit: (id) =>
      ipcRenderer.invoke(CHANNELS.gallery.undoLastCommit, id),
    onCloneProgress: (handler: (event: CloneProgress) => void) => {
      const listener = (_e: unknown, evt: CloneProgress) => handler(evt);
      ipcRenderer.on(CHANNELS.gallery.cloneProgress, listener);
      return () => ipcRenderer.off(CHANNELS.gallery.cloneProgress, listener);
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

  photoIndex: {
    build: (galleryId) =>
      ipcRenderer.invoke(CHANNELS.photoIndex.build, galleryId),
    saveDb: (galleryId, bytes, fingerprint) =>
      ipcRenderer.invoke(
        CHANNELS.photoIndex.saveDb,
        galleryId,
        bytes,
        fingerprint
      ),
    invalidate: (galleryId) =>
      ipcRenderer.invoke(CHANNELS.photoIndex.invalidate, galleryId),
    onProgress: (handler: (progress: PhotoIndexProgress) => void) => {
      const listener = (_e: unknown, progress: PhotoIndexProgress) =>
        handler(progress);
      ipcRenderer.on(CHANNELS.photoIndex.progress, listener);
      return () => ipcRenderer.off(CHANNELS.photoIndex.progress, listener);
    },
  },
};

contextBridge.exposeInMainWorld('picgBridge', bridge);
