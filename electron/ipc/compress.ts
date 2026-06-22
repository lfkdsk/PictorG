// Sharp-backed image compression in the main process. Replaces the
// renderer-side squoosh worker for desktop, which (a) tripped over
// Next 14's webpack handling of nested workers and (b) silently fell
// through to "no compression" when squoosh's dynamic imports failed
// inside the worker context.
//
// Sharp wraps libvips and emits its own EXIF on output. In practice the
// fields it copies are a subset of the originals (some camera-specific
// makernotes, GPS sub-IFDs, etc. drop out depending on the libvips
// build). The web path doesn't have this problem because it does the
// load→strip-orientation→dump→insert dance against the original bytes,
// which is byte-for-byte exact apart from the orientation tag we
// deliberately drop. We mirror that flow here so desktop and web
// produce equivalent metadata.

import { app, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
// @lfkdsk/exif-library is CJS and ships type definitions for these
// symbols; the top-level `insert` auto-detects JPEG/WebP/PNG by header.
import { dump, insert, load, TagNumbers } from '@lfkdsk/exif-library';

import { CHANNELS } from './contract';
import type {
  CompressImageRequest,
  CompressImageResult,
  CompressPreviewRequest,
  CompressPreviewResult,
} from './contract';

const execFileAsync = promisify(execFile);

// Defaults applied when the renderer's CompressImageRequest omits the
// corresponding field. Keep these aligned with src/lib/settings.ts
// DEFAULT_SETTINGS — this is the second seat of truth for
// "what does PicG do out of the box?", load-bearing for older renderers
// (or web path running with no localStorage entry yet) that send
// requests without the advanced fields.
const DEFAULT_QUALITY = 75;
const DEFAULT_WEBP_EFFORT = 6;
const DEFAULT_MAX_MP = 50;

// Clamp helpers for encoder knobs. The renderer's settings page already
// constrains the inputs, but values arrive over IPC from a process we
// don't fully control (could be a stale build, web fallback, …) so
// guard before handing to libvips. Out-of-range numbers either crash
// sharp or silently no-op depending on the build.
function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const n = Math.round(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function basenameWithoutExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

// Detect HEIC/HEIF magic bytes. ISOBMFF container — first 8 bytes are
// the box length, followed by `ftyp` and a brand. Apple's HEIC uses
// brands `heic`, `heix`, `hevc`, `hevx`; HEIF photos use `mif1`/`msf1`.
// AVIF (`avif`) is also HEIF but sharp can decode that natively, so we
// don't route it through sips.
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
]);
function isHeicLike(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.has(buf.toString('ascii', 8, 12));
}

// HEIC decode depends on macOS `sips` (and, for HDR, Core Image) — neither
// exists on Windows/Linux, and sharp's bundled libheif can't decode Apple's
// HEVC-encoded HEIC. Throw a clear, actionable error rather than letting
// execFile blow up later with a cryptic ENOENT. compressImage lets this
// surface to the user (shown per-photo in the add/new-album/shrink UIs);
// previewImage's caller catches it and falls back to a placeholder.
function assertHeicSupported(): void {
  if (process.platform !== 'darwin') {
    throw new Error(
      'HEIC images can only be processed on macOS — PicG decodes them with the ' +
        'built-in `sips` tool, which is unavailable on Windows and Linux. ' +
        'Convert these photos to JPEG or PNG first, then import them.'
    );
  }
}

// Run `sips` (macOS ImageIO CLI, ships with every Mac) to transcode the
// HEIC into a JPEG buffer that sharp can decode. sips can't read stdin
// or write stdout, so we route through a tmp file pair. Apple's
// ImageIO has a real HEVC decoder via the OS frameworks, which is what
// we're piggybacking on — sharp's prebuilt libheif is AOM-only and
// fails on Apple's HEVC-encoded HEIC with "Support for this
// compression format has not been built in".
async function decodeHeicViaSips(input: Buffer, maxEdge?: number): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picg-heic-'));
  const inPath = path.join(dir, 'in.heic');
  const outPath = path.join(dir, 'out.jpg');
  try {
    await fs.writeFile(inPath, input);
    const args = ['-s', 'format', 'jpeg'];
    // -Z caps the longest edge (preserving aspect ratio) in the same
    // decode pass. Used by the preview path so sips writes a small JPEG
    // directly — cheaper than decoding full-res then resizing, and keeps
    // the bytes we ship back over IPC small. Omitted by the compress
    // path, which wants the full-resolution decode to feed sharp.
    if (maxEdge && maxEdge > 0) args.push('-Z', String(Math.round(maxEdge)));
    args.push(inPath, '--out', outPath);
    await execFileAsync('sips', args);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Resolve the bundled `picg-heic-exr` Core Image helper (HEIC → linear EXR,
// the first half of the Ultra HDR JPEG pipeline). Packaged: Contents/Resources
// (electron-builder extraResources). Dev: build/native/, compiled by
// scripts/build-hdr-helper.js as part of `electron:build`. Cached (incl. the
// not-found result) so we warn at most once.
let cachedHelperPath: string | null | undefined;
function resolveHeicExrHelper(): string | null {
  if (cachedHelperPath !== undefined) return cachedHelperPath;
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'picg-heic-exr')]
    : [
        // Dev: build/native/, compiled by scripts/build-hdr-helper.js. Try
        // app path first, then resolve relative to this compiled file
        // (electron/dist/electron/ipc/) up to the repo root as a fallback.
        path.join(app.getAppPath(), 'build', 'native', 'picg-heic-exr'),
        path.join(__dirname, '..', '..', '..', '..', 'build', 'native', 'picg-heic-exr'),
      ];
  cachedHelperPath = candidates.find((p) => existsSync(p)) ?? null;
  if (!cachedHelperPath) {
    console.warn(
      '[picg compress] picg-heic-exr helper not found; HEIC→Ultra HDR JPEG will fall back to sharp (SDR)'
    );
  }
  return cachedHelperPath;
}

// Real dynamic import that survives tsc's CommonJS down-leveling. hdrify is
// ESM-only; a plain `import('hdrify')` gets rewritten to require() under
// `module: CommonJS` and throws ERR_REQUIRE_ESM. Routing through a Function
// keeps it a genuine runtime dynamic import.
const importESM = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<any>;

// Pull the HEIC's EXIF as an APP1 payload ("Exif\0\0" + TIFF) ready for
// hdrify's writeJpegGainMap `exif` option. exif-library can't parse the HEIC
// container, so we transcode a tiny JPEG via sips first (sips preserves EXIF)
// and read it off that. Orientation is dropped — the EXR helper already baked
// it into the pixels (.applyOrientationProperty), so a surviving tag would
// double-rotate. The thumbnail (1st IFD) is dropped too: it's redundant in a
// gain-map JPEG and keeps the APP1 segment well under its 64 KB limit.
// Best-effort: returns null (→ no EXIF embedded) on any failure.
async function extractHeicExifApp1(input: Buffer): Promise<Uint8Array | null> {
  try {
    const jpeg = await decodeHeicViaSips(input, 512);
    const exif: any = load(jpeg.toString('binary'));
    if (!exif || typeof exif !== 'object') return null;
    if (exif['0th'] && TagNumbers.ImageIFD.Orientation in exif['0th']) {
      delete exif['0th'][TagNumbers.ImageIFD.Orientation];
    }
    delete exif['1st'];
    delete exif['thumbnail'];
    const hasAny =
      Object.keys(exif['0th'] ?? {}).length > 0 ||
      Object.keys(exif['Exif'] ?? {}).length > 0 ||
      Object.keys(exif['GPS'] ?? {}).length > 0 ||
      Object.keys(exif['Interop'] ?? {}).length > 0;
    if (!hasAny) return null;
    const bytes = dump(exif);
    return Uint8Array.from(Buffer.from(bytes, 'binary'));
  } catch {
    return null;
  }
}

// HEIC → Ultra HDR JPEG (SDR base + gain map, browser-renderable HDR). Two
// stages: (1) the Core Image helper decodes the HEIC's HDR — Apple OR ISO
// 21496-1 gain map, via .expandToHDR — to a linear EXR; (2) hdrify (JS)
// encodes that to an Ultra HDR JPEG. This is the only combination that yields
// HDR a browser actually renders AND degrades gracefully to a correct SDR
// image (macOS can't write a browser-honored gain map; hdrify can't read
// HEIC). Returns null when the helper is absent so the caller falls back to
// the sharp SDR path.
async function encodeUltraHdrJpeg(
  request: CompressImageRequest,
  input: Buffer
): Promise<CompressImageResult | null> {
  const helper = resolveHeicExrHelper();
  if (!helper) return null;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picg-uhdr-'));
  const heicPath = path.join(dir, 'in.heic');
  const exrPath = path.join(dir, 'in.exr');
  try {
    await fs.writeFile(heicPath, input);
    const args = [heicPath, exrPath];
    // null = user's explicit "no cap"; undefined = use the main-side default.
    const maxMp =
      request.maxMegapixels === null
        ? null
        : request.maxMegapixels ?? DEFAULT_MAX_MP;
    if (maxMp != null) args.push('--max-megapixels', String(maxMp));
    await execFileAsync(helper, args);

    const exr = await fs.readFile(exrPath);
    const hdrify = await importESM('hdrify');
    const img = hdrify.readExr(
      new Uint8Array(exr.buffer, exr.byteOffset, exr.byteLength)
    );
    // Reinhard tone-mapping for the SDR base. hdrify's encodeGainMap defaults
    // to ACES, whose heavy shadow toe crushes dark regions (e.g. a backlit
    // tree trunk) compared to the source. Reinhard is gentler on shadows and
    // matches hdrify-cli's own default, which renders faithfully.
    const encoded = hdrify.encodeGainMap(img, { toneMapping: 'reinhard' });
    const quality = clampInt(request.quality, 0, 100, DEFAULT_QUALITY);
    // Preserve the HEIC's EXIF (camera/lens/date/GPS/exposure). hdrify embeds
    // it BEFORE computing the MPF byte offsets, so the gain map stays valid —
    // a post-hoc EXIF insert would shift those offsets and break HDR.
    const exif = request.preserveExif ? await extractHeicExifApp1(input) : null;
    const jpeg: Uint8Array = hdrify.writeJpegGainMap(encoded, {
      quality,
      format: 'ultrahdr',
      ...(exif ? { exif } : {}),
    });
    console.log('[picg compress] HEIC→Ultra HDR JPEG, bytes:', jpeg.length);
    return {
      buffer: jpeg,
      name: `${basenameWithoutExt(request.originalName)}.jpg`,
      type: 'image/jpeg',
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Mirror src/lib/compress-image.ts: pull EXIF off the original bytes,
// drop the Orientation tag (sharp.rotate() already baked it into pixels,
// keeping the tag would make viewers double-rotate), then re-inject the
// segment into the freshly-encoded output. Returns the original output
// unchanged if the input has no EXIF segment we can read.
function supplementExif(
  inputBuffer: Buffer,
  outputBuffer: Buffer
): Buffer {
  // exif-library works in binary strings (one char = one byte). Buffer's
  // 'binary' / 'latin1' encoding does that conversion both ways without
  // any bit munging.
  const inputStr = inputBuffer.toString('binary');
  let exif: any;
  try {
    exif = load(inputStr);
  } catch {
    return outputBuffer;
  }
  if (!exif || typeof exif !== 'object') return outputBuffer;
  // Empty IFDs would dump to a near-empty segment — pointless to inject.
  const hasAny =
    Object.keys(exif['0th'] ?? {}).length > 0 ||
    Object.keys(exif['Exif'] ?? {}).length > 0 ||
    Object.keys(exif['GPS'] ?? {}).length > 0 ||
    Object.keys(exif['1st'] ?? {}).length > 0 ||
    Object.keys(exif['Interop'] ?? {}).length > 0;
  if (!hasAny) return outputBuffer;

  if (exif['0th'] && TagNumbers.ImageIFD.Orientation in exif['0th']) {
    delete exif['0th'][TagNumbers.ImageIFD.Orientation];
  }

  let exifBytes: string;
  try {
    exifBytes = dump(exif);
  } catch {
    return outputBuffer;
  }

  const outputStr = outputBuffer.toString('binary');
  let merged: string;
  try {
    merged = insert(exifBytes, outputStr);
  } catch {
    return outputBuffer;
  }
  return Buffer.from(merged, 'binary');
}

async function compressImage(
  request: CompressImageRequest
): Promise<CompressImageResult> {
  let input: Buffer = Buffer.from(request.bytes);

  // Ultra HDR JPEG route — HEIC + ultrahdr output on macOS goes through the
  // Core Image (EXR) + hdrify pipeline, the only path that yields browser-
  // rendered HDR with a graceful SDR fallback. Any failure (helper missing,
  // decode/encode error) falls through to the sharp pipeline below, which
  // still produces a valid — if SDR — JPEG.
  if (
    request.outputFormat === 'ultrahdr' &&
    process.platform === 'darwin' &&
    isHeicLike(input)
  ) {
    const uhdr = await encodeUltraHdrJpeg(request, input).catch((err) => {
      console.warn(
        '[picg compress] Ultra HDR JPEG pipeline failed, falling back to sharp:',
        err?.message ?? err
      );
      return null;
    });
    if (uhdr) return uhdr;
  }

  // HEIC route — sharp's prebuilt libheif can't decode Apple's HEVC-
  // encoded HEIC, so we transcode to JPEG via macOS's `sips` first
  // and feed sharp the JPEG. EXIF is preserved by sips, then re-
  // injected via dump/insert below using the HEIC's own EXIF (which
  // is the same data, just re-routed through JPEG along the way).
  if (isHeicLike(input)) {
    assertHeicSupported();
    console.log('[picg compress] HEIC input detected, routing through sips');
    input = await decodeHeicViaSips(input);
  }

  // failOn: 'none' lets sharp keep going on minor codec warnings (slightly
  // truncated JPEG markers etc) — the input here came from a user picker,
  // not adversarial bytes, so loosening this is fine.
  let pipeline = sharp(input, { failOn: 'none' });

  // Diagnostic: log whether the source actually has EXIF before we touch it.
  const inMeta = await sharp(input, { failOn: 'none' }).metadata();
  console.log('[picg compress] input', {
    format: inMeta.format,
    hasExif: !!inMeta.exif,
    exifBytes: inMeta.exif?.length ?? 0,
    hasXmp: !!inMeta.xmp,
    hasIcc: inMeta.hasProfile,
    space: inMeta.space,
    orientation: inMeta.orientation,
  });

  // .rotate() with no args reads EXIF orientation, applies it, and resets
  // orientation to 1 in the output. Doing this here means the supplement
  // step can safely drop the Orientation tag without leaving a mismatch.
  pipeline = pipeline.rotate();

  // Preserve the source's ICC colour profile. sharp strips all input
  // metadata by default, which flattens wide-gamut (Display P3) photos to
  // sRGB — viewers then render them as sRGB and saturated colours look
  // dull (very visible on vivid landscapes). keepIccProfile() copies the
  // input profile onto the output without touching pixels (we only
  // rotate/resize here, never convert colourspace), so P3 pixels keep a
  // P3 profile; it's a no-op when the input has no profile. The EXIF
  // re-injection below leaves this intact — exif-library's insert() swaps
  // only the EXIF segment/chunk and never the APP2/ICCP that carries the
  // profile. (The Ultra HDR JPEG path is separate — it bypasses sharp via
  // the Core Image EXR helper + hdrify and manages colour itself — so this
  // only affects the sharp encode branches: jpeg, the ultrahdr SDR
  // fallback, and webp.)
  pipeline = pipeline.keepIccProfile();

  // Resolve effective knob values now so the cap branch and the encode
  // branch agree on the same numbers. `request.maxMegapixels === null`
  // is a deliberate "no cap" signal from the user's Advanced settings;
  // `undefined` means "use my default" — only one of the two should
  // disable the cap.
  const quality = clampInt(request.quality, 0, 100, DEFAULT_QUALITY);
  const webpEffort = clampInt(request.webpEffort, 0, 6, DEFAULT_WEBP_EFFORT);
  const maxPixels =
    request.maxMegapixels === null
      ? null
      : (request.maxMegapixels ?? DEFAULT_MAX_MP) * 1_000_000;

  // Cap output pixels per the resolved setting. Below the cap we leave
  // the image alone (24 MP DSLR, iPhone 12 MP, etc. pass through
  // untouched). Above it — typical 60–100 MP medium-format / high-res
  // mirrorless cameras — scale the image down to exactly the cap,
  // preserving aspect ratio.
  //
  // Skipped entirely in lossless mode OR when maxPixels is null: both
  // signal "preserve everything," and silently downsizing breaks that
  // promise.
  const inWidth = inMeta.width ?? 0;
  const inHeight = inMeta.height ?? 0;
  const inPixels = inWidth * inHeight;
  if (
    !request.lossless &&
    maxPixels != null &&
    inPixels > maxPixels &&
    inWidth > 0 &&
    inHeight > 0
  ) {
    const scale = Math.sqrt(maxPixels / inPixels);
    const targetWidth = Math.round(inWidth * scale);
    pipeline = pipeline.resize({
      width: targetWidth,
      withoutEnlargement: true,
    });
  }

  let outBuffer: Buffer;
  let extension: string;
  let mimeType: string;

  if (request.outputFormat === 'jpeg' || request.outputFormat === 'ultrahdr') {
    // 'ultrahdr' lands here only as a fallback — non-HEIC input, non-macOS,
    // or the HDR pipeline failed (input is then the sips-decoded JPEG). It
    // produces a plain SDR JPEG, the correct graceful degradation.
    outBuffer = await pipeline
      .jpeg({ mozjpeg: true, quality })
      .toBuffer();
    extension = '.jpg';
    mimeType = 'image/jpeg';
  } else if (request.lossless) {
    // Lossless WebP — every pixel preserved. quality is ignored in
    // lossless mode; effort still gates how hard the encoder works
    // to find redundant patterns. Output is 5–10× larger than lossy
    // q=75 but typically still smaller than the source HEIC/JPEG.
    outBuffer = await pipeline
      .webp({ lossless: true, effort: webpEffort })
      .toBuffer();
    extension = '.webp';
    mimeType = 'image/webp';
  } else {
    outBuffer = await pipeline
      .webp({ quality, effort: webpEffort })
      .toBuffer();
    extension = '.webp';
    mimeType = 'image/webp';
  }

  if (request.preserveExif) {
    outBuffer = supplementExif(input, outBuffer);
  }

  // Diagnostic: confirm metadata round-tripped to the output.
  try {
    const outMeta = await sharp(outBuffer).metadata();
    console.log('[picg compress] output', {
      format: outMeta.format,
      bytes: outBuffer.length,
      hasExif: !!outMeta.exif,
      exifBytes: outMeta.exif?.length ?? 0,
      hasXmp: !!outMeta.xmp,
      hasIcc: outMeta.hasProfile,
      space: outMeta.space,
      orientation: outMeta.orientation,
    });
  } catch {
    /* probing the output is best-effort; ignore failures */
  }

  return {
    buffer: new Uint8Array(outBuffer.buffer, outBuffer.byteOffset, outBuffer.byteLength),
    name: `${basenameWithoutExt(request.originalName)}${extension}`,
    type: mimeType,
  };
}

// Display-only transcode for the add-photos UI: turn a browser-undecodable
// image (overwhelmingly HEIC) into a small JPEG the renderer can show. The
// renderer only calls this after createImageBitmap has already failed, so
// we don't format-sniff — sips decodes whatever it's handed, and -Z keeps
// the output small. Distinct from compressImage: no EXIF re-injection, no
// sharp, not the uploaded artifact.
const DEFAULT_PREVIEW_MAX_EDGE = 1024;

async function previewImage(
  request: CompressPreviewRequest
): Promise<CompressPreviewResult> {
  const input = Buffer.from(request.bytes);
  // Non-macOS: no sips → throw (caught by makePreviewViaMain, which then
  // falls back to a placeholder) instead of spamming ENOENT.
  assertHeicSupported();
  const maxEdge = clampInt(request.maxEdge, 64, 4096, DEFAULT_PREVIEW_MAX_EDGE);
  const jpeg = await decodeHeicViaSips(input, maxEdge);
  return {
    buffer: new Uint8Array(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength),
    type: 'image/jpeg',
  };
}

export function registerCompressIpcHandlers(): void {
  ipcMain.handle(
    CHANNELS.compress.image,
    async (_e, request: CompressImageRequest) => {
      return compressImage(request);
    }
  );
  ipcMain.handle(
    CHANNELS.compress.preview,
    async (_e, request: CompressPreviewRequest) => {
      return previewImage(request);
    }
  );
}
