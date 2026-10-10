import { describe, expect, it } from 'vitest';
import { keys } from '../../src/lib/keys';
import { createImport, signUpload } from '../../src/server/imports';
import { testStore } from '../helpers/s3';

// The requests below are the ones @uppy/aws-s3 6.2.2 (s3-client/S3mini.js) makes in signRequest mode:
//   create:   POST <url>                      Content-Type: <file type, default application/octet-stream>, no body
//   part:     PUT  <url>                      no Content-Type; the ETag response header is read with its quotes stripped
//   complete: POST <url>                      Content-Type: application/xml
//             body <CompleteMultipartUpload><Part><PartNumber>n</PartNumber><ETag>etag-without-quotes</ETag></Part>...</CompleteMultipartUpload>
describe('direct multipart upload with URLs signed by the server', () => {
  it('creates, uploads two parts and completes, as Uppy would', async () => {
    const store = testStore('direct');
    const size = 5 * 1024 * 1024 + 123 + 4567;
    const created = await createImport(store, { entries: [{ path: 'media/big.mp4', size, lastModified: null }] });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const key = `${keys.importPrefix(id)}media/big.mp4`;

    const sign = async (req: { method: string; key: string; uploadId?: string; partNumber?: number }) => {
      const res = await signUpload(store, id, req);
      expect(res.status).toBe(200);
      return ((await res.json()) as { url: string }).url;
    };
    const send = async (url: string, init: RequestInit) => {
      const res = await fetch(url, init);
      const text = await res.text();
      expect(res.ok, `${init.method} ${res.status} ${text}`).toBe(true);
      return { res, text };
    };

    const create = await send(await sign({ method: 'POST', key }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } });
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(create.text)?.[1];
    expect(uploadId).toBeTruthy();

    const first = new Uint8Array(5 * 1024 * 1024 + 123).fill(1);
    const second = new Uint8Array(4567).fill(2);
    const etags: string[] = [];
    for (const [i, data] of [first, second].entries()) {
      const url = await sign({ method: 'PUT', key, uploadId, partNumber: i + 1 });
      const { res } = await send(url, { method: 'PUT', body: data });
      etags.push((res.headers.get('etag') ?? '').replace(/^"+|"+$/g, ''));
    }
    expect(etags.every(Boolean)).toBe(true);

    const xml = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    const done = await send(await sign({ method: 'POST', key, uploadId }), { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml });
    expect(done.text).toContain('CompleteMultipartUploadResult');

    const objects = await store.list(keys.importPrefix(id));
    expect(objects.map((o) => [o.key, o.size])).toEqual([[key, size]]);
  });
});
