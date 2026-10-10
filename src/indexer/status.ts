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

export async function readStatus(store: Store, id: string): Promise<ImportStatus | null> {
  if (!IMPORT_ID_RE.test(id)) return null;
  return store.getJson<ImportStatus>(keys.importStatus(id));
}

export async function writeStatus(store: Store, status: ImportStatus): Promise<void> {
  await store.putJson(keys.importStatus(status.id), status, PRIVATE_JSON);
}

export async function listStatuses(store: Store): Promise<ImportStatus[]> {
  const listed = (await store.list(keys.importStatusPrefix)).filter((o) => o.key.endsWith('.json'));
  const all = await mapLimit(listed, 8, (o) => store.getJson<ImportStatus>(o.key));
  return all.filter((s): s is ImportStatus => s !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
