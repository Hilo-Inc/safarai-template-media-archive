import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readManifest } from '../../src/indexer/import-files';
import { readStatus, writeStatus } from '../../src/indexer/status';
import { keys } from '../../src/lib/keys';
import { loadSite } from '../../src/lib/site';
import type { Store } from '../../src/lib/store';
import { getContent } from '../../src/server/content';
import { createImport, deleteImport, getImport, reindex, retryImport, signUpload, startImport } from '../../src/server/imports';
import { patchPost } from '../../src/server/posts';
import { updateSite, uploadAvatar } from '../../src/server/site';
import { makePost } from '../fixtures/posts';
import { stageImport } from '../helpers/imports';
import { makeJpeg } from '../helpers/media';
import { testStore } from '../helpers/s3';

const entry = (path: string, size = 3) => ({ path, size, lastModified: null });
const fakeQueue = () => ({ enqueue: vi.fn(), requestRebuild: vi.fn(async () => {}) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = async (r: Response) => r.json() as Promise<Record<string, any>>;

async function created(s: Store, paths: string[]) {
  const res = await createImport(s, { entries: paths.map((p) => entry(p)) });
  expect(res.status).toBe(201);
  return (await body(res)).id as string;
}

let workRoot: string;
beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'api-'));
});
afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

describe('imports API', () => {
  it('creates an import from the server’s own selection', async () => {
    const s = testStore('api-create');
    const res = await createImport(s, { entries: [entry('a.jpg'), entry('notes.txt'), entry('a.info.json'), entry('comments/x.jpg')] });
    expect(res.status).toBe(201);
    const { id, files } = await body(res);
    expect(files.map((f: { path: string }) => f.path).sort()).toEqual(['a.info.json', 'a.jpg']);
    expect((await readManifest(s, id))!.entries).toHaveLength(2);
    expect(await readStatus(s, id)).toMatchObject({ state: 'uploading', importer: 'generic', source: 'upload', files: 2, bytes: 6 });
  });

  it('refuses bad paths, duplicates, unknown importers and Meta exports', async () => {
    const s = testStore('api-create-bad');
    expect((await createImport(s, { entries: [entry('../a.jpg')] })).status).toBe(400);
    expect((await createImport(s, { entries: [entry('a.jpg'), entry('a.jpg')] })).status).toBe(400);
    for (const bad of ['/abs.jpg', 'a//b.jpg', 'a\\b.jpg', 'a\u0000.jpg', 'a/./b.jpg', 'a/', 'x/../../y.jpg']) {
      const res = await createImport(s, { entries: [entry(bad)] });
      expect(res.status).toBe(400);
      expect((await body(res)).error).toContain(bad);
    }
    expect((await createImport(s, { importer: 'nope', entries: [entry('a.jpg')] })).status).toBe(400);
    const meta = await createImport(s, { entries: [entry('your_instagram_activity/media/posts_1.json'), entry('media/a.jpg')] });
    expect(meta.status).toBe(400);
    expect((await body(meta)).error).toContain('Instagram or Facebook export');
    expect(await s.list(keys.importStatusPrefix)).toEqual([]);
  });

  it('signs uploads only for files in the list while uploading', async () => {
    const s = testStore('api-sign');
    const id = await created(s, ['Camera/a.jpg']);
    const ok = await signUpload(s, id, { method: 'PUT', key: `imports/${id}/Camera/a.jpg` });
    expect(ok.status).toBe(200);
    const signed = await body(ok);
    expect(signed.method).toBe('PUT');
    const put = await fetch(signed.url, { method: 'PUT', body: 'abc' });
    expect(put.ok).toBe(true);

    const part = await body(await signUpload(s, id, { method: 'PUT', key: `imports/${id}/Camera/a.jpg`, uploadId: 'u1', partNumber: 2 }));
    expect(new URL(part.url).searchParams.get('partNumber')).toBe('2');

    expect((await signUpload(s, id, { method: 'PUT', key: `imports/${id}/Camera/b.jpg` })).status).toBe(400);
    expect((await signUpload(s, id, { method: 'PUT', key: `imports/${id}/../a.jpg` })).status).toBe(400);
    expect((await signUpload(s, id, { method: 'PUT', key: '_system/site.json' })).status).toBe(400);
    expect((await signUpload(s, id, { method: 'GET', key: `imports/${id}/Camera/a.jpg` })).status).toBe(400);
    expect((await signUpload(s, 'lx0abc12-ffffff', { method: 'PUT', key: 'imports/lx0abc12-ffffff/a.jpg' })).status).toBe(404);

    expect((await startImport(s, fakeQueue(), id)).status).toBe(202);
    expect((await signUpload(s, id, { method: 'PUT', key: `imports/${id}/Camera/a.jpg` })).status).toBe(409);
  });

  it('reports what is already uploaded so the browser can skip it', async () => {
    const s = testStore('api-uploaded');
    const id = await created(s, ['a.jpg', 'b.jpg']);
    await s.put(`imports/${id}/a.jpg`, 'abc', 'image/jpeg');
    const { import: status, files, uploaded } = await body(await getImport(s, id));
    expect(status.doneIds).toBeUndefined();
    expect(files.map((f: { path: string }) => f.path).sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(uploaded).toEqual([{ path: 'a.jpg', size: 3 }]);
  });

  it('starts once and enqueues', async () => {
    const s = testStore('api-start');
    const id = await created(s, ['a.jpg']);
    const queue = fakeQueue();
    const res = await startImport(s, queue, id);
    expect(res.status).toBe(202);
    expect(queue.enqueue).toHaveBeenCalledWith(id);
    expect(await readStatus(s, id)).toMatchObject({ state: 'queued' });
    expect((await startImport(s, queue, id)).status).toBe(409);
  });

  it('retries only an import with failures', async () => {
    const s = testStore('api-retry');
    const staged = await stageImport(s, { 'a.jpg': 'a' }, { state: 'done' });
    const queue = fakeQueue();
    expect((await retryImport(s, queue, staged.id)).status).toBe(409);
    await writeStatus(s, { ...staged, state: 'done', posts: { ...staged.posts, failed: 1 } });
    expect((await retryImport(s, queue, staged.id)).status).toBe(202);
    expect(queue.enqueue).toHaveBeenCalledWith(staged.id);
  });

  it('deletes an import and its files, but not while it runs', async () => {
    const s = testStore('api-delete');
    const running = await stageImport(s, { 'a.jpg': 'a' }, { state: 'running' });
    expect((await deleteImport(s, running.id)).status).toBe(409);
    const id = await created(s, ['a.jpg']);
    await s.put(`imports/${id}/a.jpg`, 'abc', 'image/jpeg');
    expect((await deleteImport(s, id)).status).toBe(204);
    expect(await s.list(keys.importPrefix(id))).toEqual([]);
    expect(await readStatus(s, id)).toBeNull();
    expect(await readManifest(s, id)).toBeNull();
    expect((await getImport(s, id)).status).toBe(404);
  });

  it('re-indexes the inbox as an import, or just rebuilds when it is empty', async () => {
    const s = testStore('api-reindex');
    const queue = fakeQueue();
    const empty = await body(await reindex(s, queue));
    expect(empty.id).toBeNull();
    expect(queue.requestRebuild).toHaveBeenCalledOnce();

    await s.put('inbox/trip/a.jpg', 'abc', 'image/jpeg');
    const res = await reindex(s, queue);
    expect(res.status).toBe(202);
    const { id } = await body(res);
    expect(await readStatus(s, id)).toMatchObject({ source: 'inbox', state: 'queued', files: 1, bytes: 3 });
    expect(queue.enqueue).toHaveBeenCalledWith(id);
    expect((await reindex(s, queue)).status).toBe(409);
  });
});

describe('content, site and posts API', () => {
  const sign = async (k: string) => `https://signed.example/${k}`;

  it('serves post and index JSON with signed media, hiding hidden posts from visitors', async () => {
    const s = testStore('api-content');
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    await s.putJson(keys.post('files_h'), makePost('files_h', '2025-01-01T00:00:00.000Z', { hidden: true }));
    const read = <T>(k: string) => s.getJson<T>(k);
    const res = await getContent('posts/files_a.json', null, { read, sign });
    expect(res.status).toBe(200);
    expect((await body(res)).media[0].src).toBe('https://signed.example/media/files_beach-day/0/orig.jpg');
    expect((await getContent('posts/files_h.json', 'viewer', { read, sign })).status).toBe(404);
    expect((await getContent('posts/files_h.json', 'admin', { read, sign })).status).toBe(200);
    for (const bad of ['_system/site.json', 'posts/../_system/site.json', 'feed.json', 'posts/files_zz.json']) {
      expect((await getContent(bad, 'admin', { read, sign })).status).toBe(404);
    }
  });

  it('saves site details and asks for a rebuild', async () => {
    const s = testStore('api-site');
    const queue = fakeQueue();
    const res = await updateSite(s, queue, { title: 'Mine', bio: 'Hi', links: [{ label: 'Blog', url: 'https://b.example' }] });
    expect(res.status).toBe(200);
    expect(await loadSite(s)).toMatchObject({ title: 'Mine', links: [{ label: 'Blog' }] });
    expect(queue.requestRebuild).toHaveBeenCalled();
    expect((await updateSite(s, queue, { title: 'x', bio: '', links: [{ label: 'x', url: 'javascript:alert(1)' }] })).status).toBe(400);
  });

  it('stores a square, metadata-free avatar under a new name and removes the old one', async () => {
    const s = testStore('api-avatar');
    const jpg = join(workRoot, 'face.jpg');
    await makeJpeg(jpg, { width: 800, height: 600, gps: true });
    const form = () => {
      const f = new FormData();
      f.set('file', new File([readFileSync(jpg)], 'face.jpg', { type: 'image/jpeg' }));
      return f;
    };
    const first = (await body(await uploadAvatar(s, form()))).avatar as string;
    await new Promise((r) => setTimeout(r, 5));
    const second = (await body(await uploadAvatar(s, form()))).avatar as string;
    expect(second).not.toBe(first);
    expect((await s.list(keys.avatarPrefix)).map((o) => o.key)).toEqual([second]);
    expect((await loadSite(s)).avatar).toBe(second);
    const file = join(workRoot, 'avatar.webp');
    await s.download(second, file);
    const meta = await sharp(await readFile(file)).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 320, height: 320 });
    expect(meta.exif).toBeUndefined();

    const notImage = new FormData();
    notImage.set('file', new File(['hello'], 'a.jpg', { type: 'image/jpeg' }));
    expect((await uploadAvatar(s, notImage)).status).toBe(400);
  });

  it('edits a post and enforces the featured limit', async () => {
    const s = testStore('api-posts');
    for (const id of ['files_a', 'files_b', 'files_c', 'files_d']) await s.putJson(keys.post(id), makePost(id, '2025-01-01T00:00:00.000Z'));
    const queue = fakeQueue();
    const res = await patchPost(s, queue, 'files_a', { caption: 'New', hidden: true });
    expect(res.status).toBe(200);
    expect((await body(res)).post).toMatchObject({ caption: 'New', hidden: true });
    expect(queue.requestRebuild).toHaveBeenCalled();
    for (const id of ['files_a', 'files_b', 'files_c']) await patchPost(s, queue, id, { featured: true });
    const tooMany = await patchPost(s, queue, 'files_d', { featured: true });
    expect(tooMany.status).toBe(409);
    expect((await body(tooMany)).error).toBe('You can feature up to 3 posts');
    expect((await patchPost(s, queue, 'files_a', { colour: 'red' })).status).toBe(400);
    expect((await patchPost(s, queue, '../x', {})).status).toBe(404);
  });

  it('answers a generic 500 when the saved overrides are unreadable', async () => {
    const s = testStore('api-posts-bad');
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    await s.putJson(keys.overrides, { hidden: 'nope' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await patchPost(s, fakeQueue(), 'files_a', { caption: 'x' });
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledWith('patchPost failed:', 'Error: The saved post overrides are not valid');
    log.mockRestore();
    expect((await body(res)).error).toBe('Could not save the change');
  });
});
