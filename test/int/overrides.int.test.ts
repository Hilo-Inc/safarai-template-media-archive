import { describe, expect, it } from 'vitest';
import { keys } from '../../src/lib/keys';
import { readOverrides, updatePost, writePost } from '../../src/indexer/overrides';
import { removePost } from '../../src/indexer/run-import';
import type { Post } from '../../src/schema/post';
import { makePost } from '../fixtures/posts';
import { testStore } from '../helpers/s3';

describe('overrides', () => {
  it('features at most 3 posts and says so', async () => {
    const s = testStore('overrides-featured');
    for (const id of ['files_a', 'files_b', 'files_c', 'files_d']) await s.putJson(keys.post(id), makePost(id, '2025-01-01T00:00:00.000Z'));
    for (const id of ['files_a', 'files_b', 'files_c']) await updatePost(s, id, { featured: true });
    await expect(updatePost(s, 'files_d', { featured: true })).rejects.toMatchObject({ message: 'You can feature up to 3 posts', status: 409 });
    expect((await readOverrides(s)).featured).toEqual(['files_a', 'files_b', 'files_c']);
    expect((await s.getJson<Post>(keys.post('files_a')))!.featured).toBe(true);
    await expect(updatePost(s, 'files_zz', { hidden: true })).rejects.toMatchObject({ status: 404 });
  });

  it('keeps edits when the post is imported again', async () => {
    const s = testStore('overrides-reimport');
    const original = makePost('files_a', '2025-01-01T00:00:00.000Z', { caption: 'From the export' });
    await writePost(s, original);
    await updatePost(s, 'files_a', { caption: 'Fixed typo', hidden: true });
    await writePost(s, original);
    expect(await s.getJson<Post>(keys.post('files_a'))).toMatchObject({ caption: 'Fixed typo', hidden: true });
  });

  it('never loses an edit made while another write is in flight', async () => {
    const s = testStore('overrides-race');
    for (const id of ['files_a', 'files_b']) await s.putJson(keys.post(id), makePost(id, '2025-01-01T00:00:00.000Z'));
    await Promise.all([updatePost(s, 'files_a', { hidden: true }), updatePost(s, 'files_b', { hidden: true })]);
    expect((await readOverrides(s)).hidden.sort()).toEqual(['files_a', 'files_b']);
  });

  it('reads a missing file as empty but refuses one that is present and invalid', async () => {
    const s = testStore('overrides-invalid');
    expect(await readOverrides(s)).toEqual({ hidden: [], featured: [], edits: {} });
    await s.put(keys.overrides, '{"hidden": "files_a"}', 'application/json');
    await expect(readOverrides(s)).rejects.toThrow('not valid');
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    await expect(updatePost(s, 'files_a', { hidden: true })).rejects.toThrow('not valid');
    await expect(writePost(s, makePost('files_a', '2025-01-01T00:00:00.000Z'))).rejects.toThrow('not valid');
    expect(await s.getText(keys.overrides)).toBe('{"hidden": "files_a"}');
  });
  it('a post removed by an import is not written back by an edit already in flight', async () => {
    const s = testStore('overrides-remove');
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    // Hold the edit's write of the post until the removal has been requested.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = Object.create(s) as typeof s;
    slow.putJson = async (key, value, cache) => {
      if (key === keys.post('files_a')) await gate;
      return s.putJson(key, value, cache);
    };
    const edit = updatePost(slow, 'files_a', { caption: 'late edit' });
    await new Promise((r) => setTimeout(r, 200));
    const removal = removePost(s, 'files_a');
    await new Promise((r) => setTimeout(r, 200));
    release();
    await Promise.all([edit.catch(() => undefined), removal]);
    expect(await s.getJson(keys.post('files_a'))).toBeNull();
  });
});
