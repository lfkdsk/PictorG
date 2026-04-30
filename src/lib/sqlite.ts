import type { Database, SqlJsStatic } from 'sql.js';

const SQL_JS_VERSION = '1.14.1';
const SQL_WASM_URL = `https://cdn.jsdelivr.net/npm/sql.js@${SQL_JS_VERSION}/dist/sql-wasm.wasm`;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const initSqlJs = (await import('sql.js')).default;
      return initSqlJs({ locateFile: () => SQL_WASM_URL });
    })();
  }
  return sqlJsPromise;
}

const dbCache = new Map<string, Promise<Database>>();

export async function openGalleryDb(siteUrl: string): Promise<Database> {
  const key = siteUrl.replace(/\/+$/, '');
  let promise = dbCache.get(key);
  if (!promise) {
    promise = (async () => {
      const SQL = await getSqlJs();
      const res = await fetch(`${key}/sqlite.db`, { cache: 'no-cache' });
      if (!res.ok) {
        throw new Error(`Failed to fetch sqlite.db from ${key}: ${res.status} ${res.statusText}`);
      }
      const buf = await res.arrayBuffer();
      return new SQL.Database(new Uint8Array(buf));
    })();
    dbCache.set(key, promise);
    promise.catch(() => dbCache.delete(key));
  }
  return promise;
}

export function clearDbCache(): void {
  dbCache.clear();
}
