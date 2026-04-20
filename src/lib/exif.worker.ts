/// <reference lib="webworker" />

// 将原图 EXIF 合并到压缩后图片的 Web Worker。
// 主线程通过 postMessage 发送 { id, originalBuf, compressedBuf }；
// worker 返回 { id, ok: true, buffer } 或 { id, ok: false, error }。

import { load, dump, insert, TagNumbers } from '@lfkdsk/exif-library';

declare const self: DedicatedWorkerGlobalScope;

interface RequestMessage {
  id: number;
  originalBuf: ArrayBuffer;
  compressedBuf: ArrayBuffer;
}

type ResponseMessage =
  | { id: number; ok: true; buffer: ArrayBuffer }
  | { id: number; ok: false; error: string };

function bufferToBinaryString(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // 大文件分块拼接，避免 String.fromCharCode(...bytes) 爆栈
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
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out.buffer;
}

self.onmessage = (ev: MessageEvent<RequestMessage>) => {
  const { id, originalBuf, compressedBuf } = ev.data;
  try {
    const originalStr = bufferToBinaryString(originalBuf);
    const compressedStr = bufferToBinaryString(compressedBuf);

    const exif = load(originalStr);
    if (exif && exif['0th'] && TagNumbers.ImageIFD.Orientation in exif['0th']) {
      delete exif['0th'][TagNumbers.ImageIFD.Orientation];
    }

    const merged = insert(dump(exif), compressedStr);
    const buffer = binaryStringToArrayBuffer(merged);

    const response: ResponseMessage = { id, ok: true, buffer };
    self.postMessage(response, [buffer]);
  } catch (err) {
    const response: ResponseMessage = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(response);
  }
};

export {};
