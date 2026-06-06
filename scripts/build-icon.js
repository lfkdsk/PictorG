#!/usr/bin/env node
//
// Render build/icon.svg into the platform-specific icon containers
// electron-builder needs:
//   build/icon.icns (macOS) — generated via macOS `iconutil` from a
//                             .iconset folder
//   build/icon.png   (Linux + as fallback for the SVG) — single 1024
//
// macOS icns wants these specific sizes:
//   icon_16x16.png      icon_16x16@2x.png   (16, 32)
//   icon_32x32.png      icon_32x32@2x.png   (32, 64)
//   icon_128x128.png    icon_128x128@2x.png (128, 256)
//   icon_256x256.png    icon_256x256@2x.png (256, 512)
//   icon_512x512.png    icon_512x512@2x.png (512, 1024)
//
// Run on macOS only — `iconutil` is part of Xcode CLT. The script
// no-ops gracefully if iconutil is missing so a Linux CI build can
// still produce icon.png.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');

const root = process.cwd();
const buildDir = path.join(root, 'build');
const svgPath = path.join(buildDir, 'icon.svg');
const iconset = path.join(buildDir, 'icon.iconset');
const icnsOut = path.join(buildDir, 'icon.icns');
const icoOut = path.join(buildDir, 'icon.ico');
const pngOut = path.join(buildDir, 'icon.png');

if (!fs.existsSync(svgPath)) {
  console.error(`[build-icon] missing source ${svgPath}`);
  process.exit(1);
}

async function renderPng(size, file) {
  await sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

// Assemble PNG buffers into a single .ico container. ICO = a 6-byte
// ICONDIR header, then one 16-byte ICONDIRENTRY per image, then the
// image payloads. We store each image as PNG (allowed since Vista) so
// we don't have to emit BMP/DIB. A width/height byte of 0 means 256.
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // image type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  const payloads = [];
  images.forEach((img, i) => {
    const e = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0); // width (0 = 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1); // height (0 = 256)
    dir.writeUInt8(0, e + 2); // palette size (0 = no palette)
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // color planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, e + 8); // payload size
    dir.writeUInt32LE(offset, e + 12); // payload offset
    offset += img.png.length;
    payloads.push(img.png);
  });

  return Buffer.concat([header, dir, ...payloads]);
}

async function main() {
  // Single 1024 PNG — Linux uses this directly; electron-builder also
  // accepts it for macOS as an alternative to .icns.
  await renderPng(1024, pngOut);
  console.log(`[build-icon] wrote ${path.relative(root, pngOut)}`);

  // Windows .ico — electron-builder's `win.icon`. Pack several sizes so
  // Explorer, the taskbar, and Alt-Tab each pick a crisp variant. sharp
  // can't write .ico directly, so render PNGs and assemble the container
  // by hand. Produced on every host OS so a Windows build packaged from
  // any runner still gets its icon.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = [];
  for (const size of icoSizes) {
    const png = await sharp(svgPath, { density: 384 })
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    icoImages.push({ size, png });
  }
  fs.writeFileSync(icoOut, buildIco(icoImages));
  console.log(`[build-icon] wrote ${path.relative(root, icoOut)}`);

  // .iconset folder for macOS iconutil. Wipe any prior run first.
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  const variants = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of variants) {
    await renderPng(size, path.join(iconset, name));
  }

  // Compose .icns with iconutil. macOS-only; on Linux the .iconset
  // is harmless and unused.
  if (process.platform !== 'darwin') {
    console.log('[build-icon] non-macOS host, skipping .icns');
    return;
  }
  const r = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', icnsOut], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('[build-icon] iconutil failed; is Xcode CLT installed?');
    process.exit(r.status ?? 1);
  }
  console.log(`[build-icon] wrote ${path.relative(root, icnsOut)}`);

  // .iconset is just a working folder; remove now that .icns is built.
  fs.rmSync(iconset, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('[build-icon] failed', err);
  process.exit(1);
});
