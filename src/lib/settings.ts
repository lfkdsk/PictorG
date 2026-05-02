export interface CompressionSettings {
  enableWebP: boolean;
  preserveEXIF: boolean;
  outputFormat: 'webp' | 'jpeg';
  // When true, encode WebP in lossless mode (every pixel preserved,
  // no resize cap applied). Output is ~3–10× larger than lossy WebP
  // but still smaller than the original HEIC/JPEG and pixel-perfect
  // for archival use. Only meaningful when enableWebP=true and
  // outputFormat='webp' — JPEG has no lossless mode.
  lossless: boolean;
  // Encoder quality (0–100). Applied to both WebP-lossy and JPEG.
  // Ignored when lossless=true. Sharp + squoosh both default to ~75
  // here; higher values trade size for visible quality on detailed
  // photos. Values below ~60 start showing artefacts.
  quality: number;
  // WebP encoder effort (0–6). Higher = slower, smaller output for
  // the same quality. Sharp defaults to 4; we ship 6 because the
  // ~30 % encode-time hit is invisible on a desktop-tool single-photo
  // path and the 5–15 % size win is worth keeping. JPEG ignores this.
  webpEffort: number;
  // Soft ceiling on output pixels, expressed in megapixels. Above
  // this the image is scaled down (preserving aspect ratio); below
  // it the image passes through at native resolution. `null` removes
  // the cap entirely — equivalent to lossless mode's behaviour, but
  // applied independently. The original 50 MP default catches 60–
  // 100 MP medium-format / high-res mirrorless without touching
  // 24 MP DSLRs or 12 MP iPhones.
  maxMegapixels: number | null;
}

const DEFAULT_SETTINGS: CompressionSettings = {
  enableWebP: true,
  preserveEXIF: true,
  outputFormat: 'webp',
  lossless: false,
  quality: 75,
  webpEffort: 6,
  maxMegapixels: 50,
};

export const getCompressionSettings = (): CompressionSettings => {
  if (typeof window === 'undefined') {
    return DEFAULT_SETTINGS;
  }
  
  try {
    const saved = localStorage.getItem('compressionSettings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.error('Failed to load compression settings:', error);
  }
  
  return DEFAULT_SETTINGS;
};

export const saveCompressionSettings = (settings: CompressionSettings): void => {
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    localStorage.setItem('compressionSettings', JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save compression settings:', error);
  }
};
