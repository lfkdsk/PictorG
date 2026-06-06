#!/usr/bin/env node
//
// Ensures sharp's prebuilt binary for a given target arch is present in
// node_modules, installing it cross-arch if missing. Needed when the
// build host's arch differs from the arch being packaged — most notably
// building the x64 Windows installer on an arm64 Windows machine
// (Parallels on Apple Silicon).
//
// sharp ships each platform-arch prebuild as a separate os/cpu-gated
// optional dependency (@img/sharp-<os>-<arch>), so `npm ci` only installs
// the host's. The other arch must be pulled in explicitly with npm's
// --os/--cpu override. We install the exact @img package (pinned to the
// version sharp expects) rather than re-running `npm install sharp`,
// which is the reliable form on Windows (win32 host → win32 target, only
// the cpu differs; see sharp#4037 for why the os-differing direction is
// flaky).
//
// No-op when the prebuild is already present (a native build, or a prior
// run). Windows-only today — that's the only cross-arch case we package;
// on macOS electron-builder's own per-arch rebuild handles the second
// arch.
//
//   node scripts/ensure-sharp-prebuild.js <x64|arm64>

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const arch = process.argv[2];
if (arch !== 'x64' && arch !== 'arm64') {
  console.error('[ensure-sharp] usage: ensure-sharp-prebuild.js <x64|arm64>');
  process.exit(1);
}

// Only Windows cross-arch packaging is wired here. Elsewhere this is a
// deliberate no-op so it can sit unconditionally in the dist scripts.
if (process.platform !== 'win32') {
  console.log(`[ensure-sharp] platform=${process.platform} — nothing to do`);
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const pkgName = `@img/sharp-win32-${arch}`;
const installedManifest = path.join(
  root,
  'node_modules',
  '@img',
  `sharp-win32-${arch}`,
  'package.json'
);

if (fs.existsSync(installedManifest)) {
  console.log(`[ensure-sharp] ${pkgName} already present`);
  process.exit(0);
}

// Pin the exact version sharp declares so the bundled libvips ABI matches
// the sharp JS we ship.
const sharpManifest = require(path.join(root, 'node_modules', 'sharp', 'package.json'));
const range = (sharpManifest.optionalDependencies || {})[pkgName];
if (!range) {
  console.error(
    `[ensure-sharp] sharp does not list ${pkgName} in optionalDependencies — sharp too old?`
  );
  process.exit(1);
}
const version = range.replace(/^[\^~]/, '');
const spec = `${pkgName}@${version}`;

console.log(`[ensure-sharp] installing ${spec} (cross-arch from host ${process.arch})`);
// npm is npm.cmd on Windows; execFileSync needs the real filename (we
// already returned early on non-win32, so this is always Windows here).
execFileSync('npm.cmd', ['install', '--no-save', '--os=win32', `--cpu=${arch}`, spec], {
  stdio: 'inherit',
  cwd: root,
});
console.log(`[ensure-sharp] ${pkgName} ready`);
