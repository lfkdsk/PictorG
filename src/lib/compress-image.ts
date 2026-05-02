import { getCompressionSettings, CompressionSettings } from './settings';

// 动态导入，避免SSR问题
let Compress: any;
let insert: any, load: any, dump: any, TagNumbers: any;
let defaultPreprocessorState: any, defaultProcessorState: any, encoderMap: any;

const initializeLibraries = async () => {
  if (typeof window === 'undefined') return false;
  
  try {
    const squooshModule = await import('@yireen/squoosh-browser');
    Compress = squooshModule.default;
    
    const exifModule = await import('@lfkdsk/exif-library');
    insert = exifModule.insert;
    load = exifModule.load;
    dump = exifModule.dump;
    TagNumbers = exifModule.TagNumbers;
    
    const metaModule = await import('@yireen/squoosh-browser/dist/client/lazy-app/feature-meta');
    defaultPreprocessorState = metaModule.defaultPreprocessorState;
    defaultProcessorState = metaModule.defaultProcessorState;
    encoderMap = metaModule.encoderMap;
    
    return true;
  } catch (error) {
    console.error('Failed to load compression libraries:', error);
    return false;
  }
};

export const isNeedCompress = (imageType: string): boolean => {
  return /(png|jpg|jpeg|webp|avif)$/.test(imageType)
}

// Read the natural dimensions of an image File, used to decide whether
// to enable the 50 MP downsize processor. createImageBitmap is fast
// (decode happens off-thread in Chromium) and avoids us having to
// keep an <img> mounted just for measurement. Returns null on
// formats the browser can't decode (e.g. HEIC outside Safari).
async function readImageDimensions(
  file: File
): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return dims;
  } catch {
    return null;
  }
}

/**
 * 压缩图片
 */
export const compressImage = async (file: File, customSettings?: CompressionSettings): Promise<File> => {
  const settings = customSettings || getCompressionSettings();
  
  if (!settings.enableWebP || !isNeedCompress(file.type)) {
    return file;
  }

  // 初始化库
  const librariesLoaded = await initializeLibraries();
  if (!librariesLoaded) {
    console.warn('Compression libraries not available, returning original file');
    return file;
  }

  const encoderType = settings.outputFormat === 'jpeg' ? 'mozJPEG' : 'webP';

  // Build encoder options. Squoosh's encoder defaults already roughly
  // match what we want (mozJPEG quality 75, WebP quality 75 effort 4).
  // We override quality and — for WebP — effort with the user's
  // Advanced settings so web matches the desktop's tunable behaviour.
  // Lossless WebP flips the lossless flag and ignores quality; JPEG has
  // no lossless mode and the UI gates the toggle to WebP output.
  let encoderOptions: any = { ...encoderMap[encoderType].meta.defaultOptions };
  encoderOptions.quality = settings.quality;
  if (encoderType === 'webP') {
    // squoosh exposes WebP `method` 0–6 as the effort knob (libwebp
    // calls it "method", same numeric range as sharp's `effort`).
    encoderOptions.method = settings.webpEffort;
    if (settings.lossless) {
      encoderOptions = { ...encoderOptions, lossless: 1, exact: 1 };
    }
  }

  // Mirror the desktop pixel cap. Skipped in lossless mode (user
  // opted into "preserve everything") OR when the user removed the
  // cap entirely via Advanced settings. squoosh's resize processor
  // takes width/height in target pixels and respects fitMethod='contain'.
  let processorState = defaultProcessorState;
  const maxPixels =
    settings.maxMegapixels == null ? null : settings.maxMegapixels * 1_000_000;
  if (!settings.lossless && maxPixels != null) {
    try {
      const dims = await readImageDimensions(file);
      if (dims && dims.width * dims.height > maxPixels) {
        const scale = Math.sqrt(maxPixels / (dims.width * dims.height));
        processorState = {
          ...defaultProcessorState,
          resize: {
            ...defaultProcessorState.resize,
            enabled: true,
            width: Math.round(dims.width * scale),
            height: Math.round(dims.height * scale),
            method: 'lanczos3',
            fitMethod: 'contain',
          },
        };
      }
    } catch {
      /* dimension read failed — skip the cap, behave like before */
    }
  }

  const compress = new Compress(file, {
    encoderState: {
      type: encoderType,
      options: encoderOptions,
    },
    processorState,
    preprocessorState: defaultPreprocessorState,
  });

  function readFileAsString(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        resolve(reader.result as string);
      };

      reader.onerror = () => {
        reader.abort();
        reject(new DOMException('Problem parsing input file.'));
      };

      reader.readAsBinaryString(file);
    });
  }

  function writeFileWithBuffer(data: string): ArrayBuffer {
    const len = data.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = data.charCodeAt(i);
    }
    return bytes.buffer;
  }

  try {
    const result = await compress.process();

    const extension = settings.outputFormat === 'jpeg' ? '.jpg' : '.webp';
    const mimeType = settings.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';
    const originalName = result.name;
    const dotIndex = originalName.lastIndexOf('.');
    const nameWithoutExt = dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName;
    const newFileName = `${nameWithoutExt}${extension}`;
    
    if (settings.preserveEXIF) {
      try {
        const data = await readFileAsString(file);
        const originEXIF = load(data);
        console.log('Original EXIF:', originEXIF);
        
        // 删除方向信息，避免重复旋转
        if (TagNumbers.ImageIFD.Orientation in originEXIF["0th"]) {
          delete originEXIF["0th"][TagNumbers.ImageIFD.Orientation];
        }
        
        const newData = await readFileAsString(result);
        const newDataWithEXIF = insert(dump(originEXIF), newData);
        
        return new File([writeFileWithBuffer(newDataWithEXIF)], newFileName, { type: mimeType });
      } catch (error) {
        console.error('EXIF processing error:', error);
        // 如果EXIF处理失败，返回不带EXIF的压缩结果
      }
    }
    
    return new File([result], newFileName, { type: mimeType });
  } catch (error) {
    console.error('Compression error:', error);
    return file;
  }
};
