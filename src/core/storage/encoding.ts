// Cross-platform binary <-> base64 helpers. `atob`/`btoa` are available in
// browsers and Node 16+, so this module works in both environments without
// pulling in a polyfill.

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');

export function utf8ToBytes(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(utf8ToBytes(text));
}

export function base64ToUtf8(b64: string): string {
  return bytesToUtf8(base64ToBytes(b64));
}
