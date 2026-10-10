import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testStore } from '../helpers/s3';

describe('Store', () => {
  it('round-trips JSON and returns null for a missing key', async () => {
    const s = testStore('json');
    await s.putJson('a/b.json', { ok: 1 });
    expect(await s.getJson('a/b.json')).toEqual({ ok: 1 });
    expect(await s.getJson('a/missing.json')).toBeNull();
    expect(await s.exists('a/b.json')).toBe(true);
  });

  it('lists keys relative to its root and deletes a prefix', async () => {
    const s = testStore('list');
    await s.put('p/1.txt', 'one', 'text/plain');
    await s.put('p/2.txt', 'two', 'text/plain');
    await s.put('q/3.txt', 'three', 'text/plain');
    expect((await s.list('p/')).map((o) => o.key).sort()).toEqual(['p/1.txt', 'p/2.txt']);
    expect(await s.deletePrefix('p/')).toBe(2);
    expect(await s.list('p/')).toEqual([]);
    expect(await s.list('q/')).toHaveLength(1);
  });

  it('uploads and downloads a file', async () => {
    const s = testStore('file');
    const dir = await mkdtemp(join(tmpdir(), 'store-'));
    await writeFile(join(dir, 'in.bin'), Buffer.from([1, 2, 3]));
    await s.putFile('f/in.bin', join(dir, 'in.bin'), 'application/octet-stream');
    await s.download('f/in.bin', join(dir, 'out.bin'));
    expect([...(await readFile(join(dir, 'out.bin')))]).toEqual([1, 2, 3]);
  });

  it('presigns a PUT and a GET the way a browser uses them', async () => {
    const s = testStore('presign');
    const put = await s.presignUpload({ op: 'put', key: 'u/hello.txt' });
    const res = await fetch(put, { method: 'PUT', body: 'hello', headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(200);
    const get = await fetch(await s.presignGet('u/hello.txt'));
    expect(await get.text()).toBe('hello');
  });

  it('runs a presigned multipart upload and aborts leftovers', async () => {
    const s = testStore('multipart');
    const createRes = await fetch(await s.presignUpload({ op: 'create', key: 'm/big.bin' }), { method: 'POST' });
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await createRes.text())![1]!;
    const partRes = await fetch(await s.presignUpload({ op: 'part', key: 'm/big.bin', uploadId, partNumber: 1 }), {
      method: 'PUT',
      body: new Uint8Array(1024),
    });
    const etag = partRes.headers.get('etag')!;
    const done = await fetch(await s.presignUpload({ op: 'complete', key: 'm/big.bin', uploadId }), {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body: `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${etag}</ETag></Part></CompleteMultipartUpload>`,
    });
    expect(done.status).toBe(200);
    expect((await s.list('m/'))[0]!.size).toBe(1024);

    await fetch(await s.presignUpload({ op: 'create', key: 'm/left.bin' }), { method: 'POST' });
    expect(await s.abortUploads('m/')).toBe(1);
  });
});
