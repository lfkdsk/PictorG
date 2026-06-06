#!/usr/bin/env node
//
// Cross-platform wrapper for the packaging build. We can't use the
// shell-inline `PICG_PACKAGING=1 next build` form because that POSIX
// syntax doesn't work under Windows `cmd` (npm's default script shell
// on Windows). Setting the env var in-process and spawning Next's JS
// CLI entry directly behaves identically on macOS, Linux, and Windows.
//
// PICG_PACKAGING=1 flips next.config.js to `output: 'standalone'` — the
// self-contained server bundle Electron forks at runtime. After this
// runs, the caller chains scripts/stage-standalone.js to copy in the
// static/public trees.

const { spawnSync } = require('node:child_process');

process.env.PICG_PACKAGING = '1';

// Resolve Next's CLI JS entry rather than the `next` shim so we don't
// have to deal with .cmd/.ps1 resolution on Windows.
const nextBin = require.resolve('next/dist/bin/next');

const result = spawnSync(process.execPath, [nextBin, 'build'], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[next-build-packaging] failed to spawn next build:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
