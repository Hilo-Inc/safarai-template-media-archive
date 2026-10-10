import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setApiBase, uploadAll } from '../../src/client/upload';
import type { Source } from '../../src/client/listing';
import { keys } from '../../src/lib/keys';
import type { Store } from '../../src/lib/store';
import { createImport, signUpload } from '../../src/server/imports';
import { FetchXhr } from '../helpers/xhr';
import { testStore } from '../helpers/s3';

// The real Task 11 sign handler behind a tiny Node server; uploadAll talks to it through setApiBase.
let store: Store;
let server: Server;
const signBodies: { uploadId?: string }[] = [];

beforeAll(async () => {
  vi.stubGlobal('XMLHttpRequest', FetchXhr);
  store = testStore('upload-all');
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const id = /^\/api\/imports\/([^/]+)\/sign$/.exec(req.url ?? '')?.[1];
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      signBodies.push(body);
      const out = id ? await signUpload(store, id, body) : new Response('{"error":"Not found"}', { status: 404 });
      res.writeHead(out.status, { 'content-type': 'application/json' }).end(await out.text());
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  setApiBase(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
afterAll(async () => {
  setApiBase('');
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

const bytes = (n: number, fill: number) => new Blob([new Uint8Array(n).fill(fill)]);
const source = (path: string, blob: () => Promise<Blob>, size?: number): Source => ({ path, size: size ?? 0, lastModified: null, blob });
const fixed = (path: string, data: Blob): Source => source(path, async () => data, data.size);

async function newImport(sources: Source[]): Promise<string> {
  const res = await createImport(store, { entries: sources.map((s) => ({ path: s.path, size: s.size, lastModified: null })) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const uploaded = async (id: string) => {
  const prefix = keys.importPrefix(id);
  return Object.fromEntries((await store.list(prefix)).map((o) => [o.key.slice(prefix.length), o.size]));
};

describe('uploadAll against the sign endpoint and the S3 test server', () => {
  it('uploads small and multipart files, collects an unreadable file and carries on', async () => {
    const big = bytes(17 * 1024 * 1024 + 1000, 7); // two parts of at most 16 MB
    const sources = [
      fixed('media/small.jpg', bytes(1234, 1)),
      fixed('media/big.mp4', big),
      source('media/bad.jpg', () => Promise.reject(new Error('Could not read this file')), 10),
      fixed('media/after.jpg', bytes(99, 3)),
    ];
    const id = await newImport(sources);
    signBodies.length = 0;
    const progress: number[] = [];

    const { failed } = await uploadAll(id, sources, {
      alreadyBytes: 0,
      signal: new AbortController().signal,
      multipartAbove: 1024 * 1024, // 100 MB would be slow here; the real default is MULTIPART_ABOVE
      onProgress: (p) => progress.push(p.bytesDone),
    });

    expect(failed).toEqual([{ path: 'media/bad.jpg', error: 'Could not read this file' }]);
    expect(await uploaded(id)).toEqual({ 'media/small.jpg': 1234, 'media/big.mp4': big.size, 'media/after.jpg': 99 });
    expect(signBodies.some((b) => b.uploadId)).toBe(true); // the big file went through multipart
    expect(progress.at(-1)).toBe(1234 + big.size + 99); // the unreadable file is not counted as done
  });

  it('stops reading and uploading when aborted during a batch read', async () => {
    const abort = new AbortController();
    const sources = [
      // 256 MB declared (the batch limit) so the next files form later batches; the data itself is small.
      source('media/a.jpg', async () => bytes(50, 1), 256 * 1024 * 1024),
      source('media/b.jpg', async () => {
        abort.abort();
        return bytes(50, 2);
      }, 10),
      fixed('media/c.jpg', bytes(50, 3)),
    ];
    const id = await newImport(sources);

    await uploadAll(id, sources, { alreadyBytes: 0, signal: abort.signal, onProgress: () => {} });

    expect(await uploaded(id)).toEqual({ 'media/a.jpg': 50 });
  });
});
