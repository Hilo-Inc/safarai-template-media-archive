import AwsS3 from '@uppy/aws-s3';
import Uppy from '@uppy/core';
import { BATCH_BYTES, batches, chunkSize, MULTIPART_ABOVE, type Source } from './listing';

export const JSON_HEADERS = { 'content-type': 'application/json' };

let apiBase = '';
/** Where API paths are resolved. Empty (same origin) in the browser; the integration tests point it at a local server. */
export function setApiBase(base: string): void {
  apiBase = base;
}

/** Calls our API. Every write sends JSON (the server refuses other content types), even with an empty body. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiBase + path, {
    method,
    headers: method === 'GET' ? undefined : JSON_HEADERS,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface UploadProgress {
  bytesDone: number;
  bytesTotal: number;
}

type FileMeta = { archivePath: string; relativePath: string };

/** Uploads `todo` into `imports/<importId>/`, one batch at a time. Resolves with the files that failed after Uppy's retries. */
export async function uploadAll(
  importId: string,
  todo: Source[],
  opts: { alreadyBytes: number; onProgress(p: UploadProgress): void; signal: AbortSignal; multipartAbove?: number },
): Promise<{ failed: { path: string; error: string }[] }> {
  const uppy = new Uppy<FileMeta, Record<string, never>>({ autoProceed: false, allowMultipleUploadBatches: true });
  uppy.use(AwsS3, {
    limit: 4,
    allowedMetaFields: false, // no x-amz-meta-* headers: they are not part of the signature
    shouldUseMultipart: (file) => (file.size ?? 0) > (opts.multipartAbove ?? MULTIPART_ABOVE),
    getChunkSize: (file) => chunkSize(file.size),
    generateObjectKey: (file) => `imports/${importId}/${file.meta.archivePath}`,
    signRequest: async (request) => {
      const { url } = await api<{ url: string }>('POST', `/api/imports/${importId}/sign`, request);
      return { url };
    },
  });

  const bytesTotal = opts.alreadyBytes + todo.reduce((n, s) => n + s.size, 0);
  let finishedBytes = opts.alreadyBytes;
  const inFlight = new Map<string, number>();
  const report = () => {
    let current = 0;
    for (const b of inFlight.values()) current += b;
    opts.onProgress({ bytesDone: finishedBytes + current, bytesTotal });
  };
  uppy.on('upload-progress', (file, progress) => {
    if (file) inFlight.set(file.id, progress.bytesUploaded || 0);
    report();
  });
  const abort = () => uppy.cancelAll();
  opts.signal.addEventListener('abort', abort);

  const failed: { path: string; error: string }[] = [];
  try {
    for (const batch of batches(todo, BATCH_BYTES)) {
      if (opts.signal.aborted) break;
      let addedBytes = 0;
      for (const s of batch) {
        if (opts.signal.aborted) break;
        try {
          uppy.addFile({
            name: s.path.split('/').at(-1)!,
            data: await s.blob(),
            // relativePath also keeps Uppy's file ids apart for same-named files in different folders.
            meta: { archivePath: s.path, relativePath: s.path },
          });
          addedBytes += s.size;
        } catch (error) {
          // A file that cannot be read (a damaged zip entry) fails on its own; the rest carry on.
          failed.push({ path: s.path, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (opts.signal.aborted) break;
      const result = uppy.getFiles().length > 0 ? await uppy.upload() : undefined;
      for (const f of result?.failed ?? []) failed.push({ path: f.meta.archivePath, error: String(f.error ?? 'Upload failed') });
      if (opts.signal.aborted) break;
      finishedBytes += addedBytes;
      inFlight.clear();
      uppy.clear();
      report();
    }
  } finally {
    opts.signal.removeEventListener('abort', abort);
    uppy.destroy();
  }
  return { failed };
}
