import { z } from 'zod';
import { readManifest, writeManifest } from '../indexer/import-files';
import type { ImportQueue } from '../indexer/queue';
import { IMPORT_ID_RE, listStatuses, newImportId, newStatus, readStatus, writeStatus, type ImportStatus } from '../indexer/status';
import { getImporter } from '../importers/registry';
import { keys } from '../lib/keys';
import type { Store, UploadRequest } from '../lib/store';
import { importPathProblem, MAX_PATH_LENGTH, parseUploadKey } from '../lib/upload-key';
import { fail, json, parseWith } from './http';

export type QueueLike = Pick<ImportQueue, 'enqueue' | 'requestRebuild'>;

const entrySchema = z.strictObject({
  path: z.string().min(1).max(MAX_PATH_LENGTH),
  size: z.number().int().nonnegative(),
  lastModified: z.number().int().nullable(),
});

const createSchema = z.strictObject({
  importer: z.string().max(40).default('generic'),
  entries: z.array(entrySchema).min(1).max(200_000),
});

const signSchema = z.strictObject({
  method: z.enum(['PUT', 'POST', 'DELETE', 'GET']),
  key: z.string().max(MAX_PATH_LENGTH + 100),
  uploadId: z.string().min(1).max(1024).optional(),
  partNumber: z.number().int().min(1).max(10_000).optional(),
});

/** Status as the browser sees it: without the (possibly long) list of finished post ids. */
function view(status: ImportStatus): Omit<ImportStatus, 'doneIds'> {
  const { doneIds: _doneIds, ...rest } = status;
  return rest;
}

async function find(store: Store, id: string): Promise<ImportStatus | Response> {
  const status = IMPORT_ID_RE.test(id) ? await readStatus(store, id) : null;
  return status ?? fail(404, 'No such import');
}

export async function createImport(store: Store, body: unknown, now = new Date()): Promise<Response> {
  const parsed = parseWith(createSchema, body);
  if (!parsed.ok) return parsed.response;
  const { importer: name, entries } = parsed.data;
  const seen = new Set<string>();
  for (const e of entries) {
    // importPathProblem includes isNormalPath, which the runner uses to drop entries silently; refuse them here instead.
    const problem = importPathProblem(e.path);
    if (problem && problem !== 'This folder is never uploaded') return fail(400, `${problem}: ${e.path}`);
    if (seen.has(e.path)) return fail(400, `Listed twice: ${e.path}`);
    seen.add(e.path);
  }
  const importer = getImporter(name);
  if (!importer) return fail(400, `Unknown importer "${name}"`);

  // Selection works from paths alone here; the runner selects again with the files' contents.
  const selection = await importer.select({
    entries,
    readText: () => Promise.reject(new Error('Files are not uploaded yet')),
  });
  if (!selection.ok) return fail(400, selection.reason);

  const id = newImportId(now.getTime());
  await writeManifest(store, { id, importer: importer.name, entries: selection.files });
  const bytes = selection.files.reduce((n, f) => n + f.size, 0);
  await writeStatus(store, newStatus({ id, importer: importer.name, source: 'upload', files: selection.files.length, bytes }, now));
  return json(201, { id, files: selection.files });
}

export async function listImports(store: Store): Promise<Response> {
  return json(200, { imports: (await listStatuses(store)).map(view) });
}

export async function getImport(store: Store, id: string): Promise<Response> {
  const status = await find(store, id);
  if (status instanceof Response) return status;
  if (status.state !== 'uploading') return json(200, { import: view(status), files: [], uploaded: [] });
  const prefix = keys.importPrefix(id);
  const files = (await readManifest(store, id))?.entries ?? [];
  const uploaded = (await store.list(prefix)).map((o) => ({ path: o.key.slice(prefix.length), size: o.size }));
  return json(200, { import: view(status), files, uploaded });
}

function opOf(req: z.output<typeof signSchema>): UploadRequest['op'] | null {
  const { method, uploadId, partNumber } = req;
  if (method === 'PUT') return uploadId && partNumber ? 'part' : !uploadId && !partNumber ? 'put' : null;
  if (partNumber) return null;
  if (method === 'POST') return uploadId ? 'complete' : 'create';
  if (method === 'DELETE') return uploadId ? 'abort' : 'delete';
  return uploadId ? 'listParts' : null;
}

export async function signUpload(store: Store, id: string, body: unknown): Promise<Response> {
  const status = await find(store, id);
  if (status instanceof Response) return status;
  if (status.state !== 'uploading') return fail(409, 'This import is no longer accepting files');
  const parsed = parseWith(signSchema, body);
  if (!parsed.ok) return parsed.response;
  const op = opOf(parsed.data);
  if (!op) return fail(400, 'Unknown upload request');
  const key = parseUploadKey(parsed.data.key, id);
  if (!key.ok) return fail(400, key.reason);
  const manifest = await readManifest(store, id);
  if (!manifest?.entries.some((e) => e.path === key.path)) return fail(400, 'This file is not part of the import');
  const url = await store.presignUpload({ op, key: parsed.data.key, uploadId: parsed.data.uploadId, partNumber: parsed.data.partNumber });
  return json(200, { method: parsed.data.method, url });
}

export async function startImport(store: Store, queue: QueueLike, id: string): Promise<Response> {
  const status = await find(store, id);
  if (status instanceof Response) return status;
  if (status.state !== 'uploading') return fail(409, 'This import has already started');
  status.state = 'queued';
  await writeStatus(store, status);
  queue.enqueue(id);
  return json(202, { import: view(status) });
}

export async function retryImport(store: Store, queue: QueueLike, id: string): Promise<Response> {
  const status = await find(store, id);
  if (status instanceof Response) return status;
  const retryable = status.state === 'failed' || (status.state === 'done' && status.posts.failed > 0);
  if (!retryable) return fail(409, 'Nothing to retry');
  status.state = 'queued';
  await writeStatus(store, status);
  queue.enqueue(id);
  return json(202, { import: view(status) });
}

export async function deleteImport(store: Store, id: string): Promise<Response> {
  const status = await find(store, id);
  if (status instanceof Response) return status;
  if (status.state === 'queued' || status.state === 'running') return fail(409, 'Wait for this import to finish first');
  if (status.source === 'upload') {
    await store.deletePrefix(keys.importPrefix(id));
    await store.abortUploads(keys.importPrefix(id));
  }
  await store.deleteKeys([keys.importManifest(id), keys.importStatus(id)]);
  return new Response(null, { status: 204 });
}

/** Re-index: files in inbox/ become an import; with an empty inbox it is a plain index rebuild. */
export async function reindex(store: Store, queue: QueueLike, now = new Date()): Promise<Response> {
  const busy = (await listStatuses(store)).some((s) => s.source === 'inbox' && (s.state === 'queued' || s.state === 'running'));
  if (busy) return fail(409, 'A re-index is already running');
  const inbox = (await store.list(keys.inbox)).filter((o) => !o.key.endsWith('/'));
  if (inbox.length === 0) {
    void queue.requestRebuild();
    return json(202, { id: null });
  }
  const id = newImportId(now.getTime());
  const bytes = inbox.reduce((n, o) => n + o.size, 0);
  await writeStatus(store, newStatus({ id, importer: 'generic', source: 'inbox', files: inbox.length, bytes, state: 'queued' }, now));
  queue.enqueue(id);
  return json(202, { id });
}
