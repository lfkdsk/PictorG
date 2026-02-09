export interface CompressionSettings {
  enableWebP: boolean;
  preserveEXIF: boolean;
  outputFormat: 'webp' | 'jpeg';
}

const DEFAULT_SETTINGS: CompressionSettings = {
  enableWebP: true,
  preserveEXIF: true,
  outputFormat: 'webp'
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
