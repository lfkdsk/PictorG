// URL-safe path encoding for GitHub Contents API requests. Each path segment
// is encodeURIComponent'd; slashes are preserved. Lives in core because both
// adapters may want to canonicalize paths for stable cache keys.

export function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
