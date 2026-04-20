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
  return /(png|jpg|jpeg|webp|avif)$/.test(imageType);
};

// EXIF worker 单例。首次 mergeExif 调用时懒加载；创建失败则降级到主线程同步实现。
type ExifResponse =
  | { id: number; ok: true; buffer: ArrayBuffer }
  | { id: number; ok: false; error: string };

let exifWorker: Worker | null = null;
let exifWorkerDisabled = false;
let exifMessageId = 0;
const exifPending = new Map<number, (res: ExifResponse) => void>();

function getExifWorker(): Worker | null {
  if (exifWorkerDisabled) return null;
  if (exifWorker) return exifWorker;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    exifWorkerDisabled = true;
    return null;
  }
  try {
    const worker = new Worker(new URL('./exif.worker.ts', import.meta.url));
    worker.onmessage = (ev: MessageEvent<ExifResponse>) => {
      const resolver = exifPending.get(ev.data.id);
      if (resolver) {
        exifPending.delete(ev.data.id);
        resolver(ev.data);
      }
    };
    worker.onerror = (ev) => {
      console.warn('EXIF worker error, falling back to main thread:', ev.message);
      // 让所有挂起的请求走主线程回退路径
      exifPending.forEach((resolver, id) => {
        resolver({ id, ok: false, error: ev.message || 'worker error' });
      });
      exifPending.clear();
      exifWorkerDisabled = true;
      exifWorker?.terminate();
      exifWorker = null;
    };
    exifWorker = worker;
    return worker;
  } catch (error) {
    console.warn('Failed to spawn EXIF worker, using main thread fallback:', error);
    exifWorkerDisabled = true;
    return null;
  }
}

function runExifWorker(originalBuf: ArrayBuffer, compressedBuf: ArrayBuffer): Promise<ArrayBuffer> {
  const worker = getExifWorker();
  if (!worker) return Promise.reject(new Error('exif worker unavailable'));
  const id = ++exifMessageId;
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exifPending.set(id, (res) => {
      if (res.ok) resolve(res.buffer);
      else reject(new Error(res.error));
    });
    // transfer 两个 buffer 以零拷贝移交所有权
    worker.postMessage({ id, originalBuf, compressedBuf }, [originalBuf, compressedBuf]);
  });
}

// 主线程回退版本，与旧实现等价；只在 worker 不可用或失败时使用。
async function mergeExifOnMainThread(originalFile: File, compressedFile: File): Promise<ArrayBuffer> {
  const readAsBinaryString = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => {
        reader.abort();
        reject(new DOMException('Problem parsing input file.'));
      };
      reader.readAsBinaryString(file);
    });

  const originalStr = await readAsBinaryString(originalFile);
  const exif = load(originalStr);
  if (exif && exif['0th'] && TagNumbers.ImageIFD.Orientation in exif['0th']) {
    delete exif['0th'][TagNumbers.ImageIFD.Orientation];
  }
  const compressedStr = await readAsBinaryString(compressedFile);
  const merged: string = insert(dump(exif), compressedStr);

  const bytes = new Uint8Array(merged.length);
  for (let i = 0; i < merged.length; i++) {
    bytes[i] = merged.charCodeAt(i) & 0xff;
  }
  return bytes.buffer;
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
        // 优先走 worker：读 ArrayBuffer + transfer，主线程全程不阻塞
        const [originalBuf, compressedBuf] = await Promise.all([
          file.arrayBuffer(),
          result.arrayBuffer()
        ]);

        let mergedBuffer: ArrayBuffer | null = null;
        try {
          mergedBuffer = await runExifWorker(originalBuf, compressedBuf);
        } catch (workerError) {
          console.warn('EXIF worker failed, falling back to main thread:', workerError);
        }

        if (mergedBuffer) {
          return new File([mergedBuffer], newFileName, { type: mimeType });
        }

        // 回退：主线程同步实现（旧行为），保证 EXIF 能用
        const fallbackBuffer = await mergeExifOnMainThread(file, result);
        return new File([fallbackBuffer], newFileName, { type: mimeType });
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
