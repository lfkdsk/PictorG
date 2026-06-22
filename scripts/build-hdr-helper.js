#!/usr/bin/env node

// Compile the macOS Core Image helper (electron/native/picg-heic-exr.swift)
// into build/native/picg-heic-exr. It decodes a HEIC's HDR to a linear EXR —
// the first half of the Ultra HDR JPEG pipeline (hdrify does EXR → Ultra HDR
// JPEG). macOS-only — a no-op (exit 0) on every other platform so the
// Windows/Linux build pipeline is unaffected.
//
// The binary is bundled into the packaged app by scripts/after-pack.js
// (Contents/Resources/picg-heic-exr) and located at runtime by
// electron/ipc/compress.ts. Wired into the `electron:build` npm script so
// both `electron:dev` and `dist:mac` produce it.

const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') {
  console.log('[build-hdr-helper] not macOS — skipping (HEIC→HDR needs Core Image; falls back to SDR there)');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'electron', 'native', 'picg-heic-exr.swift');
const outDir = path.join(root, 'build', 'native');
const out = path.join(outDir, 'picg-heic-exr');

if (!existsSync(src)) {
  console.error(`[build-hdr-helper] source missing: ${src}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
try {
  execFileSync('swiftc', ['-O', '-o', out, src], { stdio: 'inherit' });
  console.log(`[build-hdr-helper] built ${path.relative(root, out)}`);
} catch (err) {
  console.error('[build-hdr-helper] swiftc failed:', err.message);
  process.exit(1);
}
