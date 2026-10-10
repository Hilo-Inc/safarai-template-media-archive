import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import type { ListingEntry } from '../importers/types';

export interface Source {
  path: string;
  size: number;
  lastModified: number | null;
  blob(): Promise<Blob>;
}

export const BATCH_BYTES = 256 * 1024 * 1024;
export const MULTIPART_ABOVE = 100 * 1024 * 1024;
export const MIN_PART = 16 * 1024 * 1024;
const MAX_PARTS = 9000; // S3 allows 10,000; leave room
/** Same as MAX_PATH_LENGTH on the server (src/lib/upload-key.ts, not imported: it would pull server code into the browser). A test keeps them equal. */
export const MAX_PATH = 900;

/** Forward slashes, no empty or "." segments; null for "..", control characters, an over-long path or nothing left (the server refuses those with a 400, so the file is skipped instead). */
export function normalizePath(raw: string): string | null {
  const parts = raw.replaceAll('\\', '/').split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;
  const path = parts.join('/');
  // eslint-disable-next-line no-control-regex
  if (path.length > MAX_PATH || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}

export function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/** One listing from everything dropped. Zips are read for their directory only; file data is read when uploaded. */
export async function listFiles(files: File[]): Promise<{ sources: Map<string, Source>; duplicates: number }> {
  const sources = new Map<string, Source>();
  let duplicates = 0;
  const add = (s: Source) => {
    if (sources.has(s.path)) duplicates++;
    else sources.set(s.path, s);
  };
  for (const file of files) {
    if (isZip(file)) {
      // The reader stays open: entries read their data from it later.
      const reader = new ZipReader(new BlobReader(file));
      for (const entry of await reader.getEntries()) {
        if (entry.directory) continue;
        const path = normalizePath(entry.filename);
        if (!path) continue;
        add({
          path,
          size: entry.uncompressedSize,
          lastModified: entry.lastModDate.getTime(),
          blob: () => entry.getData(new BlobWriter()),
        });
      }
    } else {
      const path = normalizePath(file.webkitRelativePath || file.name);
      if (path) add({ path, size: file.size, lastModified: file.lastModified, blob: async () => file });
    }
  }
  return { sources, duplicates };
}

export function toEntries(sources: Map<string, Source>): ListingEntry[] {
  return [...sources.values()].map((s) => ({ path: s.path, size: s.size, lastModified: s.lastModified }));
}

/** What still needs uploading for an import's file list, given what the bucket already has. */
export function planUploads(
  files: ListingEntry[],
  uploaded: { path: string; size: number }[],
  sources: Map<string, Source>,
): { todo: Source[]; done: number; doneBytes: number; missing: string[] } {
  const have = new Map(uploaded.map((u) => [u.path, u.size]));
  const todo: Source[] = [];
  const missing: string[] = [];
  let done = 0;
  let doneBytes = 0;
  for (const f of files) {
    if (have.get(f.path) === f.size) {
      done++;
      doneBytes += f.size;
      continue;
    }
    const s = sources.get(f.path);
    if (s && s.size === f.size) todo.push(s);
    else missing.push(f.path);
  }
  return { todo, done, doneBytes, missing };
}

export function chunkSize(size: number): number {
  return Math.max(MIN_PART, Math.ceil(size / MAX_PARTS));
}

export function batches(todo: Source[], maxBytes: number): Source[][] {
  const out: Source[][] = [];
  let current: Source[] = [];
  let bytes = 0;
  for (const s of todo) {
    if (current.length > 0 && bytes + s.size > maxBytes) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(s);
    bytes += s.size;
  }
  if (current.length > 0) out.push(current);
  return out;
}
