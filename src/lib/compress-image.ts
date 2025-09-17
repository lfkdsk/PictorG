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
  const compress = new Compress(file, {
    encoderState: {
      type: encoderType,
      options: encoderMap[encoderType].meta.defaultOptions
    },
    processorState: defaultProcessorState,
    preprocessorState: defaultPreprocessorState
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

  function writeFileWithBuffer(data: string): Uint8Array {
    const len = data.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = data.charCodeAt(i);
    }
    return bytes;
  }

  try {
    const result = await compress.process();
    
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
        
        // 生成新的文件名
        const originalName = result.name;
        const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
        const extension = settings.outputFormat === 'jpeg' ? '.jpg' : '.webp';
        const mimeType = settings.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';
        const newFileName = `${nameWithoutExt}${extension}`;
        
        return new File([writeFileWithBuffer(newDataWithEXIF)], newFileName, { type: mimeType });
      } catch (error) {
        console.error('EXIF processing error:', error);
        // 如果EXIF处理失败，返回不带EXIF的压缩结果
      }
    }
    
    // 不保留EXIF或EXIF处理失败时，直接返回压缩结果
    const originalName = result.name;
    const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
    const extension = settings.outputFormat === 'jpeg' ? '.jpg' : '.webp';
    const mimeType = settings.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';
    const newFileName = `${nameWithoutExt}${extension}`;
    
    return new File([result], newFileName, { type: mimeType });
  } catch (error) {
    console.error('Compression error:', error);
    return file;
  }
};