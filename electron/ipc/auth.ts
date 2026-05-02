// Token persistence over the OS-native credential store via @napi-rs/keyring
// (macOS Keychain / Windows Credential Vault / Linux libsecret). Renderer
// holds the token in localStorage for fast in-app GitHub API calls; the
// Keychain copy is the durable source of truth, used to (a) restore login
// state after a localStorage clear, (b) keep token off-disk in plaintext.
//
// `clone` no longer needs the renderer to ferry a token across IPC — it
// reads from the Keychain on demand.

import { ipcMain } from 'electron';
import { Entry } from '@napi-rs/keyring';

import { CHANNELS } from './contract';

const SERVICE = 'lfkdsk.picg';
const ACCOUNT = 'github-token';

// Hold a single Entry instance — keyring backends are cheap to recreate but
// no point if we have one.
let entry: Entry | null = null;
function getEntry(): Entry {
  if (!entry) entry = new Entry(SERVICE, ACCOUNT);
  return entry;
}

export function getStoredToken(): string | null {
  try {
    return getEntry().getPassword() ?? null;
  } catch {
    return null;
  }
}

export function registerAuthIpcHandlers(): void {
  ipcMain.handle(CHANNELS.auth.saveToken, async (_e, token: string) => {
    getEntry().setPassword(token);
  });

  ipcMain.handle(CHANNELS.auth.getToken, async () => {
    return getStoredToken();
  });

  ipcMain.handle(CHANNELS.auth.clearToken, async () => {
    try {
      getEntry().deletePassword();
    } catch {
      /* not present is fine */
    }
  });
}
