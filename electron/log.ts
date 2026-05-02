// Tiny debug log used across the main process. Writes to a tmp file
// AND mirrors to stdout. Stdout from `open`-launched .app bundles is
// thrown away by macOS, so the file is what you tail when triaging
// "the .app silently quits" failure modes.

import { appendFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const DEBUG_LOG = path.join(os.tmpdir(), 'picg-main.log');

export function logToFile(...parts: unknown[]): void {
  const line =
    `[${new Date().toISOString()}] ` +
    parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join(' ') +
    '\n';
  try {
    appendFileSync(DEBUG_LOG, line);
  } catch {
    /* tmp may be unwritable in some sandboxes */
  }
  console.log(...parts);
}
