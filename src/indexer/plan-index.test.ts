import { describe, expect, it } from 'vitest';
import { makePost } from '../../test/fixtures/posts';
import { resolveConfig } from '../config/load';
import { keys } from '../lib/keys';
import type { AdminIndex, IndexMeta, IndexPage, StoryMonth } from '../schema/index-types';
import { planIndex } from './plan-index';

const config = resolveConfig({}, {});
const now = new Date('2026-10-10T00:00:00.000Z');
const day = (n: number) => new Date(Date.UTC(2025, 0, 1) + n * 86_400_000).toISOString();
const page = (plan: Map<string, unknown>, scope: string, n = 1) => plan.get(keys.indexPage(scope, n)) as IndexPage;
const ids = (p: IndexPage) => p.posts.map((s) => s.id);

describe('planIndex', () => {
  it('writes an empty first page and meta for an empty archive', () => {
    const plan = planIndex([], config, now);
    expect(page(plan, 'all')).toEqual({ page: 1, pages: 1, posts: [] });
    expect(plan.get(keys.indexMeta)).toMatchObject({
      schema: 1,
      built: now.toISOString(),
      visibility: 'public',
      counts: { all: 0, platforms: {}, kinds: {} },
      platforms: [],
      pages: { all: 1 },
      storyMonths: [],
      tags: [],
    });
  });

  it('orders newest first and splits pages of 48', () => {
    const posts = Array.from({ length: 50 }, (_, i) => makePost(`files_p${i}`, day(i)));
    const plan = planIndex(posts, config, now);
    expect(page(plan, 'all', 1).pages).toBe(2);
    expect(page(plan, 'all', 1).posts).toHaveLength(48);
    expect(ids(page(plan, 'all', 1))[0]).toBe('files_p49');
    expect(ids(page(plan, 'all', 2))).toEqual(['files_p1', 'files_p0']);
    expect(plan.has(keys.indexPage('all', 3))).toBe(false);
  });

  it('compares times, not strings, when precision differs', () => {
    const plan = planIndex(
      [makePost('files_a', '2025-01-01T12:00:00Z'), makePost('files_b', '2025-01-01T12:00:00.500Z')],
      config,
      now,
    );
    expect(ids(page(plan, 'all'))).toEqual(['files_b', 'files_a']);
  });

  it('puts featured posts first except on tag pages', () => {
    const posts = [makePost('files_old', day(1), { featured: true, tags: ['sun'] }), makePost('files_new', day(2), { tags: ['sun'] })];
    const plan = planIndex(posts, config, now);
    expect(ids(page(plan, 'all'))).toEqual(['files_old', 'files_new']);
    expect(ids(page(plan, 'files'))).toEqual(['files_old', 'files_new']);
    expect(ids(page(plan, 'kind/post'))).toEqual(['files_old', 'files_new']);
    expect(ids(page(plan, 'tag/sun'))).toEqual(['files_new', 'files_old']);
  });

  it('leaves hidden posts and unconfigured kinds out of public indexes but not the admin index', () => {
    const onlyPosts = resolveConfig({ kinds: ['post'] }, {});
    const posts = [makePost('files_a', day(1)), makePost('files_b', day(2), { hidden: true }), makePost('files_c', day(3), { kind: 'video' })];
    const plan = planIndex(posts, onlyPosts, now);
    expect(ids(page(plan, 'all'))).toEqual(['files_a']);
    expect(plan.has(keys.indexPage('kind/video', 1))).toBe(false);
    const admin = plan.get(keys.adminIndex) as AdminIndex;
    expect(admin.posts.map((p) => [p.id, p.hidden])).toEqual([
      ['files_c', false],
      ['files_b', true],
      ['files_a', false],
    ]);
  });

  it('groups stories by month, oldest first, and keeps them out of the grid', () => {
    const posts = [
      makePost('files_s2', '2025-03-20T10:00:00.000Z', { kind: 'story' }),
      makePost('files_s1', '2025-03-02T10:00:00.000Z', { kind: 'story' }),
      makePost('files_s3', '2025-04-01T00:00:00.000Z', { kind: 'story' }),
      makePost('files_p', '2025-03-05T00:00:00.000Z'),
    ];
    const plan = planIndex(posts, config, now);
    expect(ids(page(plan, 'all'))).toEqual(['files_p']);
    const march = plan.get(keys.storyMonth('2025-03')) as StoryMonth;
    expect(march.month).toBe('2025-03');
    expect(march.posts.map((p) => [p.id, p.day])).toEqual([
      ['files_s1', 2],
      ['files_s2', 20],
    ]);
    const meta = plan.get(keys.indexMeta) as IndexMeta;
    expect(meta.storyMonths).toEqual(['2025-03', '2025-04']);
    expect(meta.counts.kinds).toEqual({ story: 3, post: 1 });
    expect(plan.has(keys.indexPage('kind/story', 1))).toBe(false);
  });

  it('keeps a story at 23:30 UTC on the last day of a month in that month, and counts stories per month', () => {
    const out = planIndex(
      [
        makePost('instagram_a', '2024-01-31T23:30:00.000Z', { kind: 'story' }),
        makePost('instagram_b', '2024-02-02T09:00:00.000Z', { kind: 'story' }),
        makePost('instagram_c', '2024-02-02T10:00:00.000Z', { kind: 'story' }),
      ],
      config,
      now,
    );
    const jan = out.get(keys.storyMonth('2024-01')) as StoryMonth;
    expect(jan.posts.map((p) => [p.id, p.day])).toEqual([['instagram_a', 31]]);
    expect((out.get(keys.indexMeta) as IndexMeta).storyCounts).toEqual({ '2024-01': 1, '2024-02': 2 });
  });

  it('leaves hidden stories out of the month indexes and counts', () => {
    const out = planIndex([makePost('instagram_h', '2024-03-01T00:00:00.000Z', { kind: 'story', hidden: true })], config, now);
    expect(out.has(keys.storyMonth('2024-03'))).toBe(false);
    expect(out.get(keys.indexMeta) as IndexMeta).toMatchObject({ storyMonths: [], storyCounts: {} });
  });

  it('indexes each platform, kind and safe tag, and counts them', () => {
    const posts = [
      makePost('files_a', day(1), { tags: ['sun', 'beach'] }),
      makePost('files_b', day(2), { tags: ['sun'], kind: 'video' }),
      makePost('youtube_c', day(3), { tags: ['sun', 'has space', 'a/b'] }),
    ];
    const plan = planIndex(posts, config, now);
    const meta = plan.get(keys.indexMeta) as IndexMeta;
    expect(meta.platforms).toEqual(['files', 'youtube']);
    expect(meta.counts).toEqual({ all: 3, platforms: { files: 2, youtube: 1 }, kinds: { post: 2, video: 1 } });
    expect(meta.tags).toEqual(['sun', 'beach']);
    expect(meta.pages).toEqual({ all: 1, files: 1, youtube: 1, 'kind/post': 1, 'kind/video': 1, 'tag/sun': 1, 'tag/beach': 1 });
    expect([...plan.keys()].some((k) => k.includes('has space') || k.includes('a/b'))).toBe(false);
  });

  it('keeps reserved platform names out of the platform counts', () => {
    const plan = planIndex([makePost('files_a', day(1)), makePost('tag_b', day(2))], config, now);
    const meta = plan.get(keys.indexMeta) as IndexMeta;
    expect(meta.platforms).toEqual(['files']);
    expect(meta.counts.platforms).toEqual({ files: 1 });
  });
});
