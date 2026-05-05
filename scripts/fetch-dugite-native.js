#!/usr/bin/env node
//
// Fetches a portable git binary (from dugite-native, the same build
// GitHub Desktop ships) into build/git/<arch>/. Lets us bundle git
// with PicG so end users don't need Xcode Command Line Tools to clone
// galleries — see desktop-development.md §4.6 for the full rationale.
//
// Layout produced:
//
//   build/git/arm64/bin/git           ← what isolatedGit.ts points at
//   build/git/arm64/libexec/git-core/ ← git-fetch-pack, git-receive-pack, etc.
//   build/git/arm64/share/git-core/   ← templates
//   build/git/arm64/etc/gitconfig     ← system config (we ignore via
//                                       GIT_CONFIG_NOSYSTEM=1, but the
//                                       file is still part of the dist)
//   build/git/x64/...                 ← same layout, x64 binaries
//
// Modes:
//
//   node scripts/fetch-dugite-native.js          host arch only (dev)
//   node scripts/fetch-dugite-native.js --all    both macOS arches (packaging)
//   node scripts/fetch-dugite-native.js --force  re-download even if present
//
// Re-runs are idempotent: presence of `build/git/<arch>/.complete` is
// the "extracted ok" marker; if it's there we skip download + extract.
//
// To bump dugite-native:
//   1. Pick a release from https://github.com/desktop/dugite-native/releases
//   2. Update DUGITE_NATIVE_VERSION + ASSET_VERSION_TAG below (the asset
//      filename embeds a short commit SHA after the version).
//   3. Run with --force to re-extract; commit the version bump only
//      (build/git/ stays gitignored; CI/postinstall fetch on demand).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Pinned version. Bump intentionally — see header.
// `v2.53.0-3` packages git 2.53.0 with patchlevel 3 of the dugite-native
// recipe. We need ≥ 2.32 for `GIT_CONFIG_GLOBAL=/dev/null` (the
// load-bearing knob in isolatedGit.ts §4.2).
const DUGITE_NATIVE_VERSION = 'v2.53.0-3';
const ASSET_VERSION_TAG = 'v2.53.0-f49d009'; // appears in the asset filename
const RELEASE_BASE = `https://github.com/desktop/dugite-native/releases/download/${DUGITE_NATIVE_VERSION}`;

const ARCHES = {
  arm64: `dugite-native-${ASSET_VERSION_TAG}-macOS-arm64.tar.gz`,
  x64: `dugite-native-${ASSET_VERSION_TAG}-macOS-x64.tar.gz`,
};

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build', 'git');

const args = new Set(process.argv.slice(2));
const wantAll = args.has('--all');
const force = args.has('--force');

// `--all` is for packaging — fetch both macOS arches because the CI
// runner is one arch but we ship two DMGs. Default (dev) is host arch
// only: avoids a 60 MB download a contributor doesn't need to run
// electron:dev on their own Mac.
const targets = wantAll
  ? Object.keys(ARCHES)
  : process.platform === 'darwin'
    ? [process.arch]
    : [];

if (targets.length === 0) {
  console.warn(
    `[fetch-dugite-native] platform=${process.platform} arch=${process.arch} — nothing to fetch (only macOS supported today)`
  );
  process.exit(0);
}

for (const arch of targets) {
  const asset = ARCHES[arch];
  if (!asset) {
    console.error(`[fetch-dugite-native] unknown arch: ${arch}`);
    process.exit(1);
  }
  const outArchDir = path.join(OUT_DIR, arch);
  const completeMarker = path.join(outArchDir, '.complete');
  if (!force && fs.existsSync(completeMarker)) {
    console.log(`[fetch-dugite-native] ${arch}: already present, skipping`);
    continue;
  }
  fetchAndExtract(arch, asset, outArchDir);
}

function fetchAndExtract(arch, asset, outArchDir) {
  const url = `${RELEASE_BASE}/${asset}`;
  const sumUrl = `${url}.sha256`;
  const tmpRoot = path.join(OUT_DIR, `.tmp-${arch}`);
  const tarPath = path.join(OUT_DIR, `.tmp-${arch}.tar.gz`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(tarPath, { force: true });

  console.log(`[fetch-dugite-native] ${arch}: downloading ${asset}`);
  // curl is preinstalled on macOS + GitHub Actions runners. Avoids
  // pulling a download dependency or wrestling Node's https stream
  // shape into a synchronous script.
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', tarPath, url], {
    stdio: 'inherit',
  });

  // sha256 sidecar is a single line: "<hex>  <filename>". Only the hex matters.
  const sumLine = execFileSync('curl', ['-sSfL', '--retry', '3', sumUrl], {
    encoding: 'utf8',
  });
  const expectedSha = sumLine.trim().split(/\s+/)[0];
  const actualSha = sha256OfFile(tarPath);
  if (expectedSha !== actualSha) {
    fs.rmSync(tarPath, { force: true });
    console.error(
      `[fetch-dugite-native] ${arch}: sha256 mismatch — expected ${expectedSha}, got ${actualSha}`
    );
    process.exit(1);
  }

  // Extract to a temp dir; rename atomically to the final location so a
  // half-extracted tree never lives at the path isolatedGit.ts will look at.
  fs.mkdirSync(tmpRoot, { recursive: true });
  console.log(`[fetch-dugite-native] ${arch}: extracting`);
  execFileSync('tar', ['-xzf', tarPath, '-C', tmpRoot], { stdio: 'inherit' });

  fs.rmSync(outArchDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outArchDir), { recursive: true });
  fs.renameSync(tmpRoot, outArchDir);
  fs.writeFileSync(path.join(outArchDir, '.complete'), `${DUGITE_NATIVE_VERSION}\n`);
  fs.rmSync(tarPath, { force: true });

  const gitPath = path.join(outArchDir, 'bin', 'git');
  if (!fs.existsSync(gitPath)) {
    console.error(`[fetch-dugite-native] ${arch}: bin/git missing after extract`);
    process.exit(1);
  }
  console.log(`[fetch-dugite-native] ${arch}: ready at ${path.relative(ROOT, gitPath)}`);
}

function sha256OfFile(p) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(p));
  return hash.digest('hex');
}
