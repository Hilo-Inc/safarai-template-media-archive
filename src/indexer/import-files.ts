import { z } from 'zod';
import type { ImportFiles, ListingEntry } from '../importers/types';
import { ImportError } from './errors';
import { keys } from '../lib/keys';
import { PRIVATE_JSON } from '../lib/site';
import type { Store } from '../lib/store';

/** Sidecar JSON and subtitles are small; anything bigger is not read as text. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export interface Manifest {
  id: string;
  importer: string;
  entries: ListingEntry[];
}

/**
 * True for a path the importers can rely on: forward slashes only, relative, no `.` or `..`
 * segments, no empty segments (so no trailing slash either) and no control characters.
 */
export function isNormalPath(path: unknown): path is string {
  if (typeof path !== 'string' || path === '') return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

const entrySchema = z.object({
  path: z.string().refine(isNormalPath),
  size: z.number().int().nonnegative(),
  lastModified: z.number().nullable(),
});

/** The stored file list; entries that are not normalised or well formed are dropped. */
export async function readManifest(store: Store, id: string): Promise<Manifest | null> {
  const raw = await store.getJson<{ id?: unknown; importer?: unknown; entries?: unknown }>(keys.importManifest(id));
  if (!raw || typeof raw !== 'object' || typeof raw.importer !== 'string' || !Array.isArray(raw.entries)) return null;
  const entries: ListingEntry[] = [];
  const seen = new Set<string>();
  for (const e of raw.entries) {
    const parsed = entrySchema.safeParse(e);
    if (!parsed.success || seen.has(parsed.data.path)) continue;
    seen.add(parsed.data.path);
    entries.push(parsed.data);
  }
  return { id, importer: raw.importer, entries };
}

export async function writeManifest(store: Store, manifest: Manifest): Promise<void> {
  await store.putJson(keys.importManifest(manifest.id), manifest, PRIVATE_JSON);
}

/** ImportFiles over bucket objects under `prefix`; only the given entries can be read. */
function bucketFiles(store: Store, prefix: string, entries: ListingEntry[]): ImportFiles {
  const known = new Map(entries.map((e) => [e.path, e]));
  const check = (path: string) => {
    const entry = known.get(path);
    if (!entry) throw new Error(`Not part of this import: ${path}`);
    return entry;
  };
  return {
    entries,
    async readText(path) {
      if (check(path).size > MAX_TEXT_BYTES) throw new Error(`Too large to read: ${path}`);
      const text = await store.getText(prefix + path);
      if (text === null) throw new Error(`Missing: ${path}`);
      return text;
    },
    async download(path, file) {
      check(path);
      await store.download(prefix + path, file);
    },
  };
}

/** The manifest's files that were uploaded completely (the stored size matches). */
export async function uploadedImportFiles(store: Store, id: string): Promise<ImportFiles & { missing: ListingEntry[] }> {
  const manifest = await readManifest(store, id);
  if (!manifest) throw new ImportError('This import has no file list');
  const prefix = keys.importPrefix(id);
  const sizes = new Map((await store.list(prefix)).map((o) => [o.key.slice(prefix.length), o.size]));
  const present = manifest.entries.filter((e) => sizes.get(e.path) === e.size);
  const missing = manifest.entries.filter((e) => sizes.get(e.path) !== e.size);
  return { ...bucketFiles(store, prefix, present), missing };
}

/** Everything under inbox/, as copied in by S3 tools. Keys that are not normalised paths are skipped. */
export async function inboxImportFiles(store: Store): Promise<ImportFiles> {
  const entries = (await store.list(keys.inbox))
    .map((o) => ({ path: o.key.slice(keys.inbox.length), size: o.size, lastModified: o.lastModified.getTime() }))
    .filter((e) => isNormalPath(e.path));
  return bucketFiles(store, keys.inbox, entries);
}
