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
  } else if (platform === 'linux') {
    stripLinuxLocales(context.appOutDir);
  }
  // Windows uses the same `locales/` layout as Linux, but we don't ship
  // Windows yet — add a stripWindowsLocales when that lands.
};

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
