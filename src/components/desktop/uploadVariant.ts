// Which bytes a photo card actually uploads: the compressed encode, or the
// "original". Shared by the add-photos and new-album pages.
//
// The wrinkle is HEIC/HEIF. Browsers can't display it, so uploading the raw
// original leaves a broken image on the published site. For those sources
// the "original" variant is a JPEG transcode (`originalJpeg`) instead. This
// matters most for Ultra HDR output: the gain-map JPEG routinely comes out
// LARGER than Apple's HEVC-coded HEIC, and the old "keep whichever is
// smaller" default then silently picked the raw HEIC.

import { getCompressionSettings } from '@/lib/settings';
import { isHeic } from './makePreview';

export type VariantPhoto = {
  original: File;
  compressed?: File;
  /** JPEG transcode of a HEIC/HEIF original — what "use original" uploads. */
  originalJpeg?: File;
  useOriginal?: boolean;
};

/** True when "use original" uploads a JPEG transcode rather than the raw file. */
export function originalConvertsToJpeg(original: File): boolean {
  return isHeic(original);
}

/**
 * Size of what "use original" would upload. For HEIC that's the JPEG
 * transcode once it exists; until then (it's made lazily) the raw size.
 */
export function originalUploadSize(p: VariantPhoto): number {
  return (p.originalJpeg ?? p.original).size;
}

/**
 * Settle a freshly-compressed photo's default choice — whichever upload is
 * smaller, so doing nothing never inflates a photo. For a HEIC source whose
 * compressed encode isn't smaller, transcode the original to JPEG and compare
 * against that instead of the raw (undisplayable) HEIC.
 */
export async function settleDefaultVariant(
  original: File,
  compressed: File,
  toJpeg: (file: File) => Promise<File>
): Promise<{ originalJpeg?: File; useOriginal: boolean }> {
  if (!originalConvertsToJpeg(original)) {
    return { useOriginal: compressed.size >= original.size };
  }
  // Compression smaller than the HEIC, or compression disabled (the
  // "compressed" file is the original itself): nothing to weigh.
  if (compressed === original || compressed.size < original.size) {
    return { useOriginal: false };
  }
  // Output is already a plain JPEG at the same settings — a transcode would
  // just reproduce it.
  if (getCompressionSettings().outputFormat === 'jpeg') {
    return { useOriginal: false };
  }
  try {
    const originalJpeg = await toJpeg(original);
    if (originalJpeg === original) return { useOriginal: false };
    return { originalJpeg, useOriginal: originalJpeg.size < compressed.size };
  } catch {
    // Transcode failed — never fall back to the raw HEIC by default.
    return { useOriginal: false };
  }
}

/**
 * The file to upload for this photo. Making the HEIC transcode here covers
 * a user who flipped to "original" on a photo whose compressed encode was
 * already smaller (so no transcode was made up front).
 */
export async function resolveUploadFile(
  p: VariantPhoto,
  toJpeg: (file: File) => Promise<File>
): Promise<File | undefined> {
  if (!p.useOriginal) return p.compressed;
  if (!originalConvertsToJpeg(p.original)) return p.original;
  return p.originalJpeg ?? (await toJpeg(p.original));
}
