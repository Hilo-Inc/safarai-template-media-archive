import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/load';
import { writeManifest } from '../../src/indexer/import-files';
import type { ItemInput, ItemResult } from '../../src/indexer/process-item';
import { runImport } from '../../src/indexer/run-import';
import { readStatus } from '../../src/indexer/status';
import { keys } from '../../src/lib/keys';
import type { Store } from '../../src/lib/store';
import type { Post } from '../../src/schema/post';
import { makePost } from '../fixtures/posts';
import { stageImport } from '../helpers/imports';
import { makeJpeg } from '../helpers/media';
import { testStore } from '../helpers/s3';

const config = resolveConfig({}, {});
let workRoot: string;
beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'run-'));
});
afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

/** Stands in for processItem: records the call, uploads one object, fails the post ids in `fail`. */
function fakeProcess(calls: string[], fail = new Set<string>()) {
  return async (input: ItemInput, s: Store): Promise<ItemResult> => {
    calls.push(input.postId);
    if (fail.has(input.postId)) return { ok: false, reason: 'Broken file' };
    const src = keys.media(input.postId, input.n, 'orig.jpg');
    await s.put(src, 'x', 'image/jpeg');
    return { ok: true, item: { type: 'image', src, width: 10, height: 10, orientation: 'square', alt: input.alt, thumbhash: null, variants: [] } };
  };
}

function deps(s: Store, extra: Partial<Parameters<typeof runImport>[1]> = {}) {
  let builds = 0;
  return {
    d: { store: s, config, workRoot, build: async () => void builds++, ...extra },
    builds: () => builds,
  };
}

describe('runImport', () => {
  it('imports an uploaded photo end to end, rebuilds and cleans up', async () => {
    const s = testStore('run-e2e');
    const jpg = join(workRoot, 'beach.jpg');
    await makeJpeg(jpg, { width: 64, height: 48 });
    const staged = await stageImport(s, { 'Camera/beach.jpg': await readFile(jpg), 'Camera/notes.txt': 'not media' });
    const { d, builds } = deps(s);

    const status = await runImport(staged.id, d);

    expect(status).toMatchObject({ state: 'done', posts: { total: 1, done: 1, failed: 0, skipped: 0 }, doneIds: ['files_beach'], error: null });
    const post = await s.getJson<Post>(keys.post('files_beach'));
    expect(post).toMatchObject({ platform: 'files', kind: 'post', published: '2025-01-01T00:00:00.000Z', media: [{ type: 'image', width: 64, height: 48 }] });
    expect(builds()).toBe(1);
    expect(await s.list(keys.importPrefix(staged.id))).toEqual([]);
    expect(await s.exists(keys.importManifest(staged.id))).toBe(false);
    expect(await readStatus(s, staged.id)).toMatchObject({ state: 'done' });
  });

  it('resumes a running import without reprocessing done posts', async () => {
    const s = testStore('run-resume');
    const staged = await stageImport(s, { 'a.jpg': 'a', 'b.jpg': 'b', 'c.jpg': 'c' }, { state: 'running', doneIds: ['files_a'] });
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    const calls: string[] = [];
    const { d } = deps(s, { process: fakeProcess(calls) });

    const status = await runImport(staged.id, d);

    expect(calls.sort()).toEqual(['files_b', 'files_c']);
    expect(status).toMatchObject({ state: 'done', posts: { total: 3, done: 3, failed: 0 } });
    expect(status!.doneIds.sort()).toEqual(['files_a', 'files_b', 'files_c']);
  });

  it('lists a failed item, keeps the upload, and a retry does only that post', async () => {
    const s = testStore('run-retry');
    const staged = await stageImport(s, { 'a.jpg': 'a', 'b.jpg': 'b' });
    const calls: string[] = [];
    const first = await runImport(staged.id, deps(s, { process: fakeProcess(calls, new Set(['files_b'])) }).d);

    expect(first).toMatchObject({ state: 'done', posts: { done: 1, failed: 1 }, failures: [{ postId: 'files_b', path: 'b.jpg', reason: 'Broken file' }] });
    expect(await s.exists(keys.post('files_b'))).toBe(false);
    expect((await s.list(keys.importPrefix(staged.id))).length).toBe(2);

    await s.putJson(keys.importStatus(staged.id), { ...first, state: 'queued' });
    calls.length = 0;
    const second = await runImport(staged.id, deps(s, { process: fakeProcess(calls) }).d);
    expect(calls).toEqual(['files_b']);
    expect(second).toMatchObject({ state: 'done', posts: { done: 2, failed: 0 }, failures: [] });
    expect(await s.list(keys.importPrefix(staged.id))).toEqual([]);
  });

  it('reports files that never finished uploading', async () => {
    const s = testStore('run-missing');
    const staged = await stageImport(s, { 'a.jpg': 'a', 'b.jpg': 'b' }, { skipUpload: ['b.jpg'] });
    const status = await runImport(staged.id, deps(s, { process: fakeProcess([]) }).d);
    expect(status).toMatchObject({ posts: { done: 1, failed: 1 }, failures: [{ postId: null, path: 'b.jpg', reason: 'This file did not finish uploading' }] });
  });

  it('skips kinds the archive does not show and removes an older copy', async () => {
    const s = testStore('run-kinds');
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    await s.put(keys.media('files_a', 0, 'old.jpg'), 'x', 'image/jpeg');
    const staged = await stageImport(s, { 'a.jpg': 'a' });
    const status = await runImport(staged.id, deps(s, { config: resolveConfig({ kinds: ['track'] }, {}), process: fakeProcess([]) }).d);
    expect(status).toMatchObject({ state: 'done', posts: { total: 1, done: 0, skipped: 1 } });
    expect(await s.exists(keys.post('files_a'))).toBe(false);
    expect(await s.list(keys.mediaPrefix('files_a'))).toEqual([]);
  });

  it('deletes media a re-imported post no longer uses', async () => {
    const s = testStore('run-orphans');
    await s.put(keys.media('files_a', 0, 'orig.mov'), 'old', 'video/quicktime');
    await s.put(keys.media('files_a', 3, 'orig.jpg'), 'old', 'image/jpeg');
    const staged = await stageImport(s, { 'a.jpg': 'a' });
    await runImport(staged.id, deps(s, { process: fakeProcess([]) }).d);
    expect((await s.list(keys.mediaPrefix('files_a'))).map((o) => o.key)).toEqual(['media/files_a/0/orig.jpg']);
  });

  it('fails the whole import when the importer refuses the files', async () => {
    const s = testStore('run-refused');
    const staged = await stageImport(s, { 'your_instagram_activity/media/posts_1.json': '[]', 'a.jpg': 'a' });
    const { d, builds } = deps(s, { process: fakeProcess([]) });
    const status = await runImport(staged.id, d);
    expect(status).toMatchObject({ state: 'failed', error: expect.stringContaining('Instagram or Facebook export') });
    expect(builds()).toBe(0);
  });

  it('imports from the inbox and deletes the processed files', async () => {
    const s = testStore('run-inbox');
    const staged = await stageImport(s, { 'trip/a.jpg': 'a', 'trip/readme.txt': 'keep' }, { source: 'inbox' });
    const status = await runImport(staged.id, deps(s, { process: fakeProcess([]) }).d);
    expect(status).toMatchObject({ state: 'done', posts: { done: 1 } });
    expect((await s.list(keys.inbox)).map((o) => o.key)).toEqual(['inbox/trip/readme.txt']);
  });

  it('leaves a finished import alone', async () => {
    const s = testStore('run-finished');
    const staged = await stageImport(s, { 'a.jpg': 'a' }, { state: 'done' });
    const calls: string[] = [];
    expect(await runImport(staged.id, deps(s, { process: fakeProcess(calls) }).d)).toMatchObject({ state: 'done' });
    expect(calls).toEqual([]);
  });

  it('ignores manifest entries that are not normalised paths', async () => {
    const s = testStore('run-bad-manifest');
    const staged = await stageImport(s, { 'ok.jpg': 'a' });
    const entry = (path: string) => ({ path, size: 1, lastModified: 0 });
    await writeManifest(s, {
      id: staged.id,
      importer: 'generic',
      entries: ['ok.jpg', '../evil.jpg', '/abs.jpg', 'a//b.jpg', './c.jpg', 'x\\y.jpg', 'd/../e.jpg'].map(entry),
    });
    await s.put(keys.importPrefix(staged.id) + '../evil.jpg', 'x', 'image/jpeg');
    const calls: string[] = [];
    const status = await runImport(staged.id, deps(s, { process: fakeProcess(calls) }).d);
    expect(calls).toEqual(['files_ok']);
    expect(status).toMatchObject({ state: 'done', posts: { total: 1, done: 1, failed: 0 } });
  });
});
