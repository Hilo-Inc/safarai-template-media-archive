import { writeManifest } from '../../src/indexer/import-files';
import { newImportId, newStatus, writeStatus, type ImportState, type ImportStatus } from '../../src/indexer/status';
import { keys } from '../../src/lib/keys';
import type { Store } from '../../src/lib/store';

/** Puts files where the browser (or an S3 tool, for the inbox) would, plus the status and manifest the API would write. */
export async function stageImport(
  s: Store,
  files: Record<string, string | Uint8Array>,
  opts: { id?: string; state?: ImportState; doneIds?: string[]; source?: 'upload' | 'inbox'; skipUpload?: string[] } = {},
): Promise<ImportStatus> {
  const id = opts.id ?? newImportId();
  const source = opts.source ?? 'upload';
  const entries = [];
  for (const [path, body] of Object.entries(files)) {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    if (!opts.skipUpload?.includes(path)) {
      await s.put(source === 'upload' ? keys.importPrefix(id) + path : keys.inbox + path, bytes, 'application/octet-stream');
    }
    entries.push({ path, size: bytes.length, lastModified: Date.UTC(2025, 0, 1) });
  }
  if (source === 'upload') await writeManifest(s, { id, importer: 'generic', entries });
  const status: ImportStatus = {
    ...newStatus({ id, importer: 'generic', source, files: entries.length, bytes: entries.reduce((n, e) => n + e.size, 0) }, new Date()),
    state: opts.state ?? 'queued',
    doneIds: opts.doneIds ?? [],
  };
  await writeStatus(s, status);
  return status;
}
