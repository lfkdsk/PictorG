/// <reference lib="webworker" />

// 整个 squoosh 压缩流程都放到这里，确保 mozJPEG / webP 的 WASM 同步编码
// 不会阻塞主线程。squoosh 原实现里用了 document.createElement('canvas') 以及
// 一些 DOM 特性检测（picture/img/source），这里通过 OffscreenCanvas + 哑对象
// 做一层 shim 绕过，从而能跑在 DedicatedWorkerGlobalScope 里。

import Compress from '@yireen/squoosh-browser';
import {
  defaultPreprocessorState,
  defaultProcessorState,
  encoderMap
} from '@yireen/squoosh-browser/dist/client/lazy-app/feature-meta';
import { load, dump, insert, TagNumbers } from '@lfkdsk/exif-library';

declare const self: DedicatedWorkerGlobalScope;

// ----- DOM shim -----
// squoosh 用 document.createElement('canvas') 作为画布；用 'picture'/'img'/'source'
// 做 canDecodeImageType 特性检测。worker 里用 OffscreenCanvas 替代画布，
// 其余 tag 返回哑对象让属性赋值和 append 不抛错即可。
const documentShim = {
  createElement(tag: string) {
    if (tag === 'canvas') {
      const canvas = new OffscreenCanvas(1, 1);
      // canvasEncode 走 'toBlob' in canvas 分支，shim 到 convertToBlob
      (canvas as any).toBlob = (
        cb: (blob: Blob | null) => void,
        type?: string,
        quality?: number
      ) => {
        canvas
          .convertToBlob({ type, quality })
          .then(cb, () => cb(null));
      };
      return canvas;
    }
    // picture/img/source 只用于特性检测，返回一个哑对象即可
    const dummy: any = {
      srcset: '',
      type: '',
      currentSrc: '',
      append() {
        /* no-op */
      }
    };
    return dummy;
  }
};
(self as any).document = documentShim;

// ----- EXIF 工具（与旧 exif worker 保持一致的行为） -----
function bufferToBinaryString(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length);
    result += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)));
  }
  return result;
}

function binaryStringToArrayBuffer(str: string): ArrayBuffer {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out.buffer;
}

async function mergeExif(originalFile: File | Blob, compressedBlob: Blob): Promise<ArrayBuffer> {
  const [origBuf, compBuf] = await Promise.all([
    originalFile.arrayBuffer(),
    compressedBlob.arrayBuffer()
  ]);
  const exif = load(bufferToBinaryString(origBuf));
  if (exif && exif['0th'] && TagNumbers.ImageIFD.Orientation in exif['0th']) {
    delete exif['0th'][TagNumbers.ImageIFD.Orientation];
  }
  const merged = insert(dump(exif), bufferToBinaryString(compBuf));
  return binaryStringToArrayBuffer(merged);
}

// ----- 消息协议 -----
interface CompressRequest {
  id: number;
  file: File;
  outputFormat: 'jpeg' | 'webp';
  preserveEXIF: boolean;
}

type CompressResponse =
  | { id: number; ok: true; buffer: ArrayBuffer; mimeType: string; extension: string }
  | { id: number; ok: false; error: string };

self.onmessage = async (ev: MessageEvent<CompressRequest>) => {
  const { id, file, outputFormat, preserveEXIF } = ev.data;

  try {
    const encoderType = outputFormat === 'jpeg' ? 'mozJPEG' : 'webP';
    const extension = outputFormat === 'jpeg' ? '.jpg' : '.webp';
    const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';

    const compress = new (Compress as any)(file, {
      encoderState: {
        type: encoderType,
        options: encoderMap[encoderType].meta.defaultOptions
      },
      processorState: defaultProcessorState,
      preprocessorState: defaultPreprocessorState
    });

    const compressedFile: File = await compress.process();

    let outBuffer: ArrayBuffer;
    if (preserveEXIF) {
      try {
        outBuffer = await mergeExif(file, compressedFile);
      } catch (err) {
        // EXIF 合并失败不影响压缩结果
        outBuffer = await compressedFile.arrayBuffer();
      }
    } else {
      outBuffer = await compressedFile.arrayBuffer();
    }

    const response: CompressResponse = {
      id,
      ok: true,
      buffer: outBuffer,
      mimeType,
      extension
    };
    self.postMessage(response, [outBuffer]);
  } catch (err) {
    const response: CompressResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(response);
  }
};

export {};
