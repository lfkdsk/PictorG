import { getCompressionSettings, CompressionSettings } from './settings';

export const isNeedCompress = (imageType: string): boolean => {
  return /(png|jpg|jpeg|webp|avif)$/.test(imageType);
};

// ----- 压缩 Worker 单例 -----
// 主路径：把整个 squoosh 压缩 + EXIF 合并都放到 worker 里跑。
// 主线程完全空闲，不会再触发"无响应"提示。
type CompressResponse =
  | { id: number; ok: true; buffer: ArrayBuffer; mimeType: string; extension: string }
  | { id: number; ok: false; error: string };

let compressWorker: Worker | null = null;
let compressWorkerDisabled = false;
let compressMessageId = 0;
const compressPending = new Map<number, (res: CompressResponse) => void>();

function getCompressWorker(): Worker | null {
  if (compressWorkerDisabled) return null;
  if (compressWorker) return compressWorker;
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    compressWorkerDisabled = true;
    return null;
  }
  try {
    const worker = new Worker(new URL('./compress.worker.ts', import.meta.url));
    worker.onmessage = (ev: MessageEvent<CompressResponse>) => {
      const resolver = compressPending.get(ev.data.id);
      if (resolver) {
        compressPending.delete(ev.data.id);
        resolver(ev.data);
      }
    };
    worker.onerror = (ev) => {
      console.warn('Compress worker crashed, falling back to main thread:', ev.message);
      compressPending.forEach((resolver, id) => {
        resolver({ id, ok: false, error: ev.message || 'worker error' });
      });
      compressPending.clear();
      compressWorkerDisabled = true;
      compressWorker?.terminate();
      compressWorker = null;
    };
    compressWorker = worker;
    return worker;
  } catch (error) {
    console.warn('Failed to spawn compress worker, using main thread fallback:', error);
    compressWorkerDisabled = true;
    return null;
  }
}

function runCompressWorker(
  file: File,
  outputFormat: 'jpeg' | 'webp',
  preserveEXIF: boolean
): Promise<{ buffer: ArrayBuffer; mimeType: string; extension: string }> {
  const worker = getCompressWorker();
  if (!worker) return Promise.reject(new Error('compress worker unavailable'));
  const id = ++compressMessageId;
  return new Promise((resolve, reject) => {
    compressPending.set(id, (res) => {
      if (res.ok) resolve({ buffer: res.buffer, mimeType: res.mimeType, extension: res.extension });
      else reject(new Error(res.error));
    });
    // file 通过 structured clone 传递；浏览器内部按引用处理 blob 数据，不会复制整块字节
    worker.postMessage({ id, file, outputFormat, preserveEXIF });
  });
}

// ----- 主线程回退路径 -----
// 仅在 Worker/OffscreenCanvas 不可用（老 Safari 等）或 worker 抛错时触发，
// 行为与最初的实现一致，保证 EXIF 与压缩都不会失效。
let Compress: any;
let insert: any, load: any, dump: any, TagNumbers: any;
let defaultPreprocessorState: any, defaultProcessorState: any, encoderMap: any;
let fallbackLibsLoaded = false;

async function loadFallbackLibraries(): Promise<boolean> {
  if (fallbackLibsLoaded) return true;
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
    fallbackLibsLoaded = true;
    return true;
  } catch (error) {
    console.error('Failed to load compression libraries:', error);
    return false;
  }
}

function readAsBinaryString(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => {
      reader.abort();
      reject(new DOMException('Problem parsing input file.'));
    };
    reader.readAsBinaryString(file);
  });
}

async function compressOnMainThread(
  file: File,
  outputFormat: 'jpeg' | 'webp',
  preserveEXIF: boolean
): Promise<File> {
  const ok = await loadFallbackLibraries();
  if (!ok) return file;

  const encoderType = outputFormat === 'jpeg' ? 'mozJPEG' : 'webP';
  const extension = outputFormat === 'jpeg' ? '.jpg' : '.webp';
  const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';

  const compress = new Compress(file, {
    encoderState: {
      type: encoderType,
      options: encoderMap[encoderType].meta.defaultOptions
    },
    processorState: defaultProcessorState,
    preprocessorState: defaultPreprocessorState
  });

  const result: File = await compress.process();
  const originalName = result.name;
  const dotIndex = originalName.lastIndexOf('.');
  const nameWithoutExt = dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName;
  const newFileName = `${nameWithoutExt}${extension}`;

  if (preserveEXIF) {
    try {
      const data = await readAsBinaryString(file);
      const exif = load(data);
      if (exif && exif['0th'] && TagNumbers.ImageIFD.Orientation in exif['0th']) {
        delete exif['0th'][TagNumbers.ImageIFD.Orientation];
      }
      const newData = await readAsBinaryString(result);
      const merged: string = insert(dump(exif), newData);
      const bytes = new Uint8Array(merged.length);
      for (let i = 0; i < merged.length; i++) bytes[i] = merged.charCodeAt(i) & 0xff;
      return new File([bytes.buffer], newFileName, { type: mimeType });
    } catch (error) {
      console.error('EXIF processing error (fallback):', error);
    }
  }

  return new File([result], newFileName, { type: mimeType });
}

/**
 * 压缩图片。
 * 默认走 Web Worker 路径（squoosh + EXIF 都在 worker 里），失败再回退到主线程。
 */
export const compressImage = async (file: File, customSettings?: CompressionSettings): Promise<File> => {
  const settings = customSettings || getCompressionSettings();

  if (!settings.enableWebP || !isNeedCompress(file.type)) {
    return file;
  }

  const outputFormat: 'jpeg' | 'webp' = settings.outputFormat === 'jpeg' ? 'jpeg' : 'webp';
  const preserveEXIF = !!settings.preserveEXIF;

  // 新文件名基于原始文件名 + 新扩展名
  const extension = outputFormat === 'jpeg' ? '.jpg' : '.webp';
  const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const originalName = file.name;
  const dotIndex = originalName.lastIndexOf('.');
  const nameWithoutExt = dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName;
  const newFileName = `${nameWithoutExt}${extension}`;

  // 优先走 Worker
  try {
    const { buffer } = await runCompressWorker(file, outputFormat, preserveEXIF);
    return new File([buffer], newFileName, { type: mimeType });
  } catch (workerError) {
    console.warn('Compress worker failed, falling back to main thread:', workerError);
  }

  // 回退：主线程 squoosh（旧行为）
  try {
    return await compressOnMainThread(file, outputFormat, preserveEXIF);
  } catch (error) {
    console.error('Compression error (fallback):', error);
    return file;
  }
};
