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

// Shape of <userData>/auth.json. `identity` is filled lazily the first
// time a git commit needs an author — see ensureGitIdentity(). We
// persist it so subsequent sessions don't re-hit the GitHub API.
//
// `identity.source` is optional on the wire because pre-2026-05-04
// builds wrote `{ name, email }` without it. The reader normalizes
// missing source → 'oauth' (legacy persistence only happened from
// successful fetches).
type AuthFile = {
  token?: string;
  identity?: {
    name: string;
    email: string;
    source?: GitIdentity['source'];
  };
};

export type GitIdentity = {
  name: string;
  email: string;
  // Where the identity came from. 'oauth' means it was derived from
  // the GitHub /user response (fresh or persisted-from-prior-session).
  // 'fallback' means we couldn't reach GitHub or had no token, and
  // are using the generic PicG identity so commits don't block.
  // Surfaced in PushReceipt so the UI can explain to the user why
  // commits are attributed the way they are.
  source: 'oauth' | 'fallback';
};

function tokenPath(): string {
  return path.join(app.getPath('userData'), 'auth.json');
}

function readAuthFile(): AuthFile {
  try {
    const p = tokenPath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, 'utf-8')) as AuthFile;
  } catch {
    return {};
  }
}

function writeAuthFile(next: AuthFile): void {
  const p = tokenPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next), { encoding: 'utf-8' });
  // 0600 so other local accounts can't read it. Best-effort — chmod is
  // a no-op on Windows.
  try {
    chmodSync(p, 0o600);
  } catch {
    /* non-POSIX FS */
  }
}

export function getStoredToken(): string | null {
  return readAuthFile().token ?? null;
}

function setStoredToken(token: string): void {
  // Replacing the token always invalidates the cached identity — a
  // different token may belong to a different GitHub account.
  cachedIdentity = null;
  writeAuthFile({ token });
}

function clearStoredToken(): void {
  cachedIdentity = null;
  const p = tokenPath();
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* not present is fine */
  }
}

// In-memory cache so we never re-hit GitHub more than once per process
// even before we get a chance to persist. Set lazily by ensureGitIdentity().
let cachedIdentity: GitIdentity | null = null;
// Coalesce concurrent first-time fetches — two parallel commits at
// boot would otherwise issue two GET /user calls.
let identityFetchInFlight: Promise<GitIdentity> | null = null;

// Fallback used when GitHub is unreachable or the token has been
// revoked. Commits still succeed; the pusher (visible on github.com)
// is determined by the OAuth token, not by this local identity.
const FALLBACK_IDENTITY: GitIdentity = {
  name: 'PicG',
  email: 'noreply@picg.app',
  source: 'fallback',
};

// Resolve a (name, email) tuple to embed in commits. Three-tier lookup:
//   1. process-level cache  (zero cost)
//   2. <userData>/auth.json (one disk read, no network)
//   3. GET https://api.github.com/user with the stored token
//
// Tier 3 result is persisted to auth.json so the next session goes
// through tier 2. Anything that throws on the network path falls back
// to a generic PicG identity rather than blocking the commit — local
// commit history stays usable even offline / token-revoked.
export async function ensureGitIdentity(): Promise<GitIdentity> {
  if (cachedIdentity) return cachedIdentity;

  const persisted = readAuthFile().identity;
  if (persisted?.name && persisted?.email) {
    // Legacy auth.json entries (pre-source field) were always written
    // by fetchAndStoreIdentity, so default to 'oauth' on read.
    const normalized: GitIdentity = {
      name: persisted.name,
      email: persisted.email,
      source: persisted.source ?? 'oauth',
    };
    cachedIdentity = normalized;
    return normalized;
  }

  if (identityFetchInFlight) return identityFetchInFlight;

  identityFetchInFlight = fetchAndStoreIdentity()
    .catch((err) => {
      console.warn(
        `[picg] could not resolve GitHub identity (${err instanceof Error ? err.message : err}); falling back to ${FALLBACK_IDENTITY.email}`
      );
      cachedIdentity = FALLBACK_IDENTITY;
      return FALLBACK_IDENTITY;
    })
    .finally(() => {
      identityFetchInFlight = null;
    });

  return identityFetchInFlight;
}

async function fetchAndStoreIdentity(): Promise<GitIdentity> {
  const token = getStoredToken();
  if (!token) throw new Error('no token stored');

  // Node 18+ has global fetch — Electron main runs Node ≥ 20 per the
  // dev doc §5.1, so this is safe without a polyfill.
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'PicG-Desktop',
    },
  });
  if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`);

  const body = (await res.json()) as {
    login?: string;
    name?: string | null;
    id?: number;
    email?: string | null;
  };
  const login = body.login;
  if (!login) throw new Error('GitHub /user returned no login');

  // Email priority:
  //   1. Public email on the user's profile (if they've set one)
  //   2. Modern noreply form `<id>+<login>@users.noreply.github.com`
  //      — works for accounts created after 2017-07
  //   3. Legacy noreply `<login>@users.noreply.github.com`
  // Either noreply form is accepted by GitHub for commit attribution.
  const email =
    body.email ||
    (body.id ? `${body.id}+${login}@users.noreply.github.com` : null) ||
    `${login}@users.noreply.github.com`;
  const name = body.name || login;

  const identity: GitIdentity = { name, email, source: 'oauth' };
  cachedIdentity = identity;

  // Persist alongside the token. Don't overwrite the token itself
  // here — readAuthFile() returns a snapshot, and a concurrent
  // setStoredToken would race. Re-read inline.
  const current = readAuthFile();
  writeAuthFile({ ...current, identity });

  return identity;
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
