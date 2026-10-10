import { randomBytes } from 'node:crypto';
import { keys } from '../lib/keys';
import { mapLimit } from '../lib/pool';
import { PRIVATE_JSON } from '../lib/site';
import type { Store } from '../lib/store';

export const IMPORT_ID_RE = /^[0-9a-z]{6,12}-[0-9a-f]{6}$/;
export const MAX_FAILURES = 200;

export type ImportState = 'uploading' | 'queued' | 'running' | 'done' | 'failed';

export interface ImportFailure {
  postId: string | null;
  path: string | null;
  reason: string;
}

export interface ImportStatus {
  id: string;
  importer: string;
  source: 'upload' | 'inbox';
  state: ImportState;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  files: number;
  bytes: number;
  posts: { total: number; done: number; failed: number; skipped: number };
  doneIds: string[];
  failures: ImportFailure[];
  error: string | null;
}

/** Time first (base 36), so ids sort by creation; 6 random hex characters so they cannot be guessed. */
export function newImportId(now = Date.now()): string {
  return `${now.toString(36)}-${randomBytes(3).toString('hex')}`;
}

export function newStatus(
  fields: Pick<ImportStatus, 'id' | 'importer' | 'source' | 'files' | 'bytes'> & { state?: ImportState },
  now: Date,
): ImportStatus {
  return {
    state: 'uploading',
    ...fields,
    createdAt: now.toISOString(),
    startedAt: null,
    finishedAt: null,
    posts: { total: 0, done: 0, failed: 0, skipped: 0 },
    doneIds: [],
    failures: [],
    error: null,
  };
}

export function addFailure(status: ImportStatus, failure: ImportFailure): void {
  status.posts.failed++;
  if (status.failures.length < MAX_FAILURES) status.failures.push(failure);
}

/** What a status file that cannot be parsed shows as: a failed import the admin can remove. */
function unreadable(id: string): ImportStatus {
  return { ...newStatus({ id, importer: 'generic', source: 'upload', files: 0, bytes: 0, state: 'failed' }, new Date(0)), error: 'Status file unreadable' };
}

async function readOne(store: Store, key: string, id: string): Promise<ImportStatus | null> {
  try {
    return await store.getJson<ImportStatus>(key);
  } catch (error) {
    // Not even JSON (a hand edit or an interrupted tool). Store errors still propagate.
    if (!(error instanceof SyntaxError)) throw error;
    console.warn(`Import status ${key} is not valid JSON`);
    return unreadable(id);
  }
}

export async function readStatus(store: Store, id: string): Promise<ImportStatus | null> {
  if (!IMPORT_ID_RE.test(id)) return null;
  return readOne(store, keys.importStatus(id), id);
}

export async function writeStatus(store: Store, status: ImportStatus): Promise<void> {
  await store.putJson(keys.importStatus(status.id), status, PRIVATE_JSON);
}

export async function listStatuses(store: Store): Promise<ImportStatus[]> {
  const listed = (await store.list(keys.importStatusPrefix)).filter((o) => o.key.endsWith('.json'));
  const all = await mapLimit(listed, 8, (o) => {
    const id = o.key.slice(keys.importStatusPrefix.length, -'.json'.length);
    return IMPORT_ID_RE.test(id) ? readOne(store, o.key, id) : Promise.resolve(null);
  });
  return all.filter((s): s is ImportStatus => s !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
