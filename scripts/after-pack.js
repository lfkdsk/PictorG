// electron-builder afterPack hook — runs once per (platform,arch)
// after the app dir is laid out and before signing. We use it to:
//
//   1. Strip Chromium locale.pak files for languages we don't ship
//      (~30 MB savings on macOS). electron-builder's top-level
//      `electronLanguages` option is documented but in 24.x it's
//      unreliable in `--dir` mode and didn't actually trim our
//      output. Doing the delete by hand is bulletproof.
//
// Runs *before* code signing, so the resulting bundle has a single
// consistent signature once electron-builder finishes the rest.

const fs = require('node:fs');
const path = require('node:path');

// Whitelist matches what we put in electron-builder.yml's
// electronLanguages — left in BOTH places because (a) future
// electron-builder versions may finally honor that option and (b)
// other afterPack hooks might re-read it.
const KEEP_LOCALES = new Set([
  'en', 'en_GB',
  'zh_CN', 'zh_TW',
]);

exports.default = async function afterPack(context) {
  const productFilename = context.packager.appInfo.productFilename;
  const platform = context.electronPlatformName;

  if (platform === 'darwin') {
    stripDarwinLocales(context.appOutDir, productFilename);
  } else if (platform === 'linux' || platform === 'win32') {
    // Windows lays Chromium locales out exactly like Linux:
    // `<appOutDir>/locales/<code>.pak` — so the same stripper works.
    stripLinuxLocales(context.appOutDir);
  }

  // electron-builder's extraResources copy ALWAYS omits node_modules
  // (filtered or not — it treats node_modules as asar-managed), so the
  // Next standalone server shipped without its dependency tree and the
  // app failed to launch (require('next') → MODULE_NOT_FOUND, no window).
  // Copy the standalone's node_modules into place ourselves.
  copyStandaloneNodeModules(context.appOutDir, platform, productFilename);

  // macOS-only Core Image helper that decodes HEIC → HDR EXR (first half of
  // the Ultra HDR JPEG pipeline). Copied in before signing so it picks up the
  // app's signature; located at runtime via process.resourcesPath in
  // electron/ipc/compress.ts.
  copyHdrHelper(context.appOutDir, platform, productFilename);
};

// Place the compiled picg-heic-exr helper in Contents/Resources. macOS-only;
// built by scripts/build-hdr-helper.js during `electron:build`. If it's
// missing the app still works — compress.ts falls back to sharp (SDR JPEG).
function copyHdrHelper(appOutDir, platform, productFilename) {
  if (platform !== 'darwin') return;
  const root = path.resolve(__dirname, '..');
  const src = path.join(root, 'build', 'native', 'picg-heic-exr');
  if (!fs.existsSync(src)) {
    console.warn(
      '[after-pack] build/native/picg-heic-exr missing — HEIC→Ultra HDR JPEG will fall back to sharp. Did `electron:build` run on macOS?'
    );
    return;
  }
  const dest = path.join(
    appOutDir,
    `${productFilename}.app`,
    'Contents',
    'Resources',
    'picg-heic-exr'
  );
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`[after-pack] bundled HEIC→EXR helper → ${path.relative(appOutDir, dest)}`);
}

// The Next standalone server.js does relative require()s into its own
// bundled node_modules tree. electron-builder won't copy that tree via
// extraResources, so we copy it from the freshly-built
// .next/standalone/node_modules into the packaged standalone dir.
function copyStandaloneNodeModules(appOutDir, platform, productFilename) {
  const root = path.resolve(__dirname, '..');
  const src = path.join(root, '.next', 'standalone', 'node_modules');
  if (!fs.existsSync(src)) {
    console.warn(
      '[after-pack] .next/standalone/node_modules missing — did `next build` (PICG_PACKAGING=1) run? Skipping.'
    );
    return;
  }

  const resourcesDir =
    platform === 'darwin'
      ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources'); // win32 + linux

  const destStandalone = path.join(resourcesDir, 'standalone');
  if (!fs.existsSync(destStandalone)) {
    console.warn(
      `[after-pack] ${destStandalone} missing — extraResources didn't stage the standalone? Skipping.`
    );
    return;
  }

  const dest = path.join(destStandalone, 'node_modules');
  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(src, dest);
  console.log(
    `[after-pack] copied Next standalone node_modules → ${path.relative(appOutDir, dest)}`
  );
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      // Preserve symlinks where possible; fall back to copying the target.
      try {
        fs.symlinkSync(fs.readlinkSync(s), d);
      } catch {
        try {
          fs.copyFileSync(fs.realpathSync(s), d);
        } catch {
          /* dangling link — skip */
        }
      }
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function stripDarwinLocales(appOutDir, productFilename) {
  const resourcesDir = path.join(
    appOutDir,
    `${productFilename}.app`,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
  );
  if (!fs.existsSync(resourcesDir)) return;

  let removed = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(resourcesDir)) {
    if (!entry.endsWith('.lproj')) continue;
    const code = entry.slice(0, -'.lproj'.length);
    if (KEEP_LOCALES.has(code)) continue;
    const full = path.join(resourcesDir, entry);
    bytes += dirSize(full);
    fs.rmSync(full, { recursive: true, force: true });
    removed += 1;
  }
  console.log(
    `[after-pack] removed ${removed} unused locale dir(s), ` +
      `~${(bytes / 1024 / 1024).toFixed(1)} MB freed`
  );
}

function stripLinuxLocales(appOutDir) {
  // Linux: locales live at `<appOutDir>/locales/<code>.pak`.
  const localesDir = path.join(appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;
  let removed = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(localesDir)) {
    if (!entry.endsWith('.pak')) continue;
    const code = entry.slice(0, -'.pak'.length);
    if (KEEP_LOCALES.has(code)) continue;
    const full = path.join(localesDir, entry);
    bytes += fs.statSync(full).size;
    fs.unlinkSync(full);
    removed += 1;
  }
  console.log(
    `[after-pack] removed ${removed} unused locale pak(s), ` +
      `~${(bytes / 1024 / 1024).toFixed(1)} MB freed`
  );
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}
