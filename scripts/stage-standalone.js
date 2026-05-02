#!/usr/bin/env node
//
// Next 14's `output: 'standalone'` produces a self-contained server
// bundle at .next/standalone/, but it intentionally does NOT include
// the static asset trees — those are runtime concerns, not server
// code, so Next leaves it to the deployment to copy them in.
//
// We copy:
//   .next/static  → .next/standalone/.next/static
//   public        → .next/standalone/public
//
// After this runs, .next/standalone/ is fully self-contained: spawn
// `node server.js` from there with PORT/HOSTNAME env and it boots.
//
// electron-builder's extraResources picks up the whole tree wholesale
// via `from: .next/standalone, to: standalone`.

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

if (!fs.existsSync(standalone)) {
  console.error(
    '[stage-standalone] .next/standalone not found — did `next build` run with PICG_PACKAGING=1?'
  );
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(s);
      try {
        fs.symlinkSync(target, d);
      } catch {
        fs.copyFileSync(s, d);
      }
    } else fs.copyFileSync(s, d);
  }
}

const moves = [
  { from: path.join(root, '.next', 'static'), to: path.join(standalone, '.next', 'static') },
  { from: path.join(root, 'public'), to: path.join(standalone, 'public') },
];

for (const { from, to } of moves) {
  if (!fs.existsSync(from)) {
    console.warn(`[stage-standalone] skipping ${from} (does not exist)`);
    continue;
  }
  // Wipe destination so a stale earlier run doesn't leave orphans.
  fs.rmSync(to, { recursive: true, force: true });
  copyDir(from, to);
  console.log(`[stage-standalone] copied ${path.relative(root, from)} → ${path.relative(root, to)}`);
}

console.log('[stage-standalone] standalone bundle ready at .next/standalone');
