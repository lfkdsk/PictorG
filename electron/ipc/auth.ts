// Token persistence in a plain JSON file under <userData>/auth.json.
//
// We previously used @napi-rs/keyring against the OS keychain (macOS
// Keychain / Windows Credential Vault / libsecret). It worked, but
// Keychain access prompts the user for their login password the first
// time a freshly-built version reads it back — and that prompt fires
// repeatedly during dev rebuilds because every fresh signed binary is
// treated as a separate caller. Annoying enough that the user asked for
// it gone.
//
// The replacement: write the token to <userData>/auth.json with mode
// 0600 so only the user can read it. Same threat model as the renderer
// localStorage fallback we already had — protects against other local
// users + device theft if FileVault is on, doesn't protect against
// malware running as the same user. Acceptable for a personal
// photo-publishing tool; if you need defense-in-depth, swap back to
// keyring (and accept the prompts).

import { ipcMain, app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import * as path from 'node:path';

import { CHANNELS } from './contract';

function tokenPath(): string {
  return path.join(app.getPath('userData'), 'auth.json');
}

export function getStoredToken(): string | null {
  try {
    const p = tokenPath();
    if (!existsSync(p)) return null;
    const obj = JSON.parse(readFileSync(p, 'utf-8')) as { token?: string };
    return obj.token ?? null;
  } catch {
    return null;
  }
}

function setStoredToken(token: string): void {
  const p = tokenPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ token }), { encoding: 'utf-8' });
  // 0600 so other local accounts can't read it. Best-effort — chmod is
  // a no-op on Windows.
  try {
    chmodSync(p, 0o600);
  } catch {
    /* non-POSIX FS */
  }
}

function clearStoredToken(): void {
  const p = tokenPath();
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* not present is fine */
  }
}

export function registerAuthIpcHandlers(): void {
  ipcMain.handle(CHANNELS.auth.saveToken, async (_e, token: string) => {
    setStoredToken(token);
  });

  ipcMain.handle(CHANNELS.auth.getToken, async () => {
    return getStoredToken();
  });

  ipcMain.handle(CHANNELS.auth.clearToken, async () => {
    clearStoredToken();
  });
}
