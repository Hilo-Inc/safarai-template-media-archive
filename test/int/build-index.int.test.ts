import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../src/config/load';
import { buildIndex } from '../../src/indexer/build-index';
import { keys } from '../../src/lib/keys';
import type { IndexPage } from '../../src/schema/index-types';
import { makePost } from '../fixtures/posts';
import { testStore } from '../helpers/s3';

const config = resolveConfig({}, {});
const now = new Date('2026-10-10T00:00:00.000Z');

describe('buildIndex', () => {
  it('writes pages, meta, schema and feeds, skips bad posts and removes stale pages', async () => {
    const s = testStore('build-public');
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    await s.putJson(keys.post('files_b'), makePost('files_b', '2025-01-02T00:00:00.000Z'));
    await s.putJson(keys.post('files_bad'), { schema: 1, id: 'files_bad' });
    await s.putJson(keys.indexPage('youtube', 1), { page: 1, pages: 1, posts: [] });

    const result = await buildIndex(s, config, { siteUrl: 'https://a.example', mediaPublicUrl: null, now });

    expect(result).toEqual({ posts: 2, skipped: ['posts/files_bad.json'], feeds: true });
    expect((await s.getJson<IndexPage>(keys.indexPage('all', 1)))!.posts.map((p) => p.id)).toEqual(['files_b', 'files_a']);
    expect(await s.exists(keys.indexPage('youtube', 1))).toBe(false);
    expect(await s.exists(keys.indexMeta)).toBe(true);
    expect(await s.exists(keys.adminIndex)).toBe(true);
    expect(await s.getJson<{ $id: string }>(keys.schema)).toMatchObject({ $id: 'post.v1.json' });
    expect(JSON.parse((await s.getText(keys.feedJson))!).items).toHaveLength(2);
    expect(await s.getText(keys.rss)).toContain('<rss');
  });

  it('removes feeds in password mode and when there is no site address', async () => {
    const s = testStore('build-nofeeds');
    await s.putJson(keys.post('files_a'), makePost('files_a', '2025-01-01T00:00:00.000Z'));
    await s.put(keys.feedJson, '{}', 'application/json');
    await s.put(keys.rss, '<rss/>', 'application/rss+xml');

    const password = await buildIndex(s, resolveConfig({ visibility: 'password' }, {}), { siteUrl: 'https://a.example', mediaPublicUrl: null, now });
    expect(password.feeds).toBe(false);
    expect(await s.exists(keys.feedJson)).toBe(false);
    expect(await s.exists(keys.rss)).toBe(false);

    const noAddress = await buildIndex(s, config, { siteUrl: null, mediaPublicUrl: null, now });
    expect(noAddress.feeds).toBe(false);
    expect(await s.exists(keys.feedJson)).toBe(false);
  });

  it('skips a post that is not JSON but lets store errors stop the build', async () => {
    const s = testStore('build-notjson');
    await s.put(keys.post('files_junk'), 'not json', 'application/json');
    const result = await buildIndex(s, config, { siteUrl: null, mediaPublicUrl: null, now });
    expect(result.skipped).toEqual(['posts/files_junk.json']);

    vi.spyOn(s, 'getJson').mockRejectedValue(new Error('store down'));
    await expect(buildIndex(s, config, { siteUrl: null, mediaPublicUrl: null, now })).rejects.toThrow('store down');
  });
});
