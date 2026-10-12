import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../config/load';
import type { IndexPage } from '../schema/index-types';
import { makePost, samplePost } from '../../test/fixtures/posts';
import { absoluteUrl, gridScope, loadChrome, loadGrid, loadPost, loadStoryMonth, morePosts, ogImage, parsePage, scopeFromParam, postTitle, tagPostCount, type PageDeps } from './pages';

const config = resolveConfig({}, {});
const sign = async (src: string) => `https://media.example/${src}`;

function deps(objects: Record<string, unknown>, extra: Partial<PageDeps> = {}): PageDeps {
  return {
    read: async <T,>(key: string) => (key in objects ? (objects[key] as T) : null),
    sign,
    config,
    mediaPublicUrl: null,
    ...extra,
  };
}

describe('gridScope and parsePage', () => {
  it('accepts the three scopes and refuses the rest', () => {
    expect(gridScope('all', undefined, config)).toEqual({ scope: 'all', basePath: '/', title: null });
    expect(gridScope('kind', 'video', config)).toEqual({ scope: 'kind/video', basePath: '/kind/video', title: 'Videos' });
    expect(gridScope('tag', 'summer', config)).toEqual({ scope: 'tag/summer', basePath: '/tags/summer', title: '#summer' });
    expect(gridScope('kind', 'story', config)).toBeNull();
    expect(gridScope('kind', 'track', resolveConfig({ kinds: ['post'] }, {}))).toBeNull();
    expect(gridScope('kind', 'nope', config)).toBeNull();
    expect(gridScope('tag', 'a/b', config)).toBeNull();
    expect(gridScope('tag', 'Summer', config)).toBeNull();
  });

  it('reads the fragment scope parameter', () => {
    expect(scopeFromParam('all', config)?.scope).toBe('all');
    expect(scopeFromParam('kind/video', config)?.scope).toBe('kind/video');
    expect(scopeFromParam('tag/summer', config)?.scope).toBe('tag/summer');
    expect(scopeFromParam('tag/a/b', config)).toBeNull();
    expect(scopeFromParam('../_system', config)).toBeNull();
    expect(scopeFromParam(null, config)).toBeNull();
  });

  it.each([
    [null, 1],
    ['1', 1],
    ['12', 12],
    ['0', null],
    ['-1', null],
    ['1e3', null],
    ['x', null],
    ['999999', null],
  ])('page %j → %j', (raw, expected) => {
    expect(parsePage(raw)).toBe(expected);
  });
});

describe('loadGrid', () => {
  const page: IndexPage = {
    page: 1,
    pages: 2,
    posts: [{ id: 'files_a', kind: 'post', platform: 'files', published: '2025-01-01T00:00:00.000Z', caption: '', cover: { type: 'image', src: 'media/files_a/0/orig.jpg', width: 10, height: 10, thumbhash: null, variants: [] }, count: 1, duration: null, featured: false }],
  };
  const all = gridScope('all', undefined, config)!;

  it('signs cover keys', async () => {
    const out = await loadGrid(all, 1, deps({ 'index/all/0001.json': page }));
    expect(out?.posts[0]?.cover?.src).toBe('https://media.example/media/files_a/0/orig.jpg');
  });

  it('shows an empty first page before the first build, and 404s other missing pages', async () => {
    expect(await loadGrid(all, 1, deps({}))).toEqual({ page: 1, pages: 1, posts: [] });
    expect(await loadGrid(all, 2, deps({}))).toBeNull();
    expect(await loadGrid(gridScope('tag', 'summer', config)!, 1, deps({}))).toBeNull();
  });
});

describe('loadPost', () => {
  const hidden = makePost('files_secret', '2025-01-01T00:00:00.000Z', { hidden: true });
  const objects = { 'posts/files_beach-day.json': samplePost, 'posts/files_secret.json': hidden, 'posts/files_bad.json': { schema: 1 } };

  it('signs media keys', async () => {
    const post = await loadPost('files_beach-day', null, deps(objects));
    expect(post?.media[0]?.src).toBe('https://media.example/media/files_beach-day/0/orig.jpg');
  });

  it('shows hidden posts only to the owner', async () => {
    expect(await loadPost('files_secret', null, deps(objects))).toBeNull();
    expect(await loadPost('files_secret', 'viewer', deps(objects))).toBeNull();
    expect((await loadPost('files_secret', 'admin', deps(objects)))?.hidden).toBe(true);
  });

  it('hides kinds the config leaves out, except from the owner', async () => {
    const postsOnly = { ...deps(objects), config: resolveConfig({ kinds: ['video'] }, {}) };
    expect(await loadPost('files_beach-day', null, postsOnly)).toBeNull();
    expect(await loadPost('files_beach-day', 'admin', postsOnly)).not.toBeNull();
  });

  it('returns null for bad ids, missing and invalid posts', async () => {
    expect(await loadPost('../_system/site', 'admin', deps(objects))).toBeNull();
    expect(await loadPost('files_missing', 'admin', deps(objects))).toBeNull();
    expect(await loadPost('files_bad', 'admin', deps(objects))).toBeNull();
  });
});

describe('ogImage', () => {
  const post = { ...samplePost, media: [{ ...samplePost.media[0]!, variants: [{ w: 640, src: 'https://media.example/w640' }, { w: 1280, src: 'https://media.example/w1280' }] }] } as typeof samplePost;

  it('uses the largest variant only in public mode with a media domain', () => {
    expect(ogImage(post, deps({}, { mediaPublicUrl: 'https://media.example' }))).toBe('https://media.example/w1280');
    expect(ogImage(post, deps({}))).toBeNull();
    expect(ogImage(post, deps({}, { mediaPublicUrl: 'https://media.example', config: resolveConfig({ visibility: 'password' }, {}) }))).toBeNull();
  });
});

describe('loadChrome', () => {
  it('falls back to the default site and signs the avatar', async () => {
    expect((await loadChrome(deps({ '_system/site.json': { title: 5 } }))).site.title).toBe('Archive');
    const chrome = await loadChrome(deps({ '_system/site.json': { title: 'Ours', avatar: 'media/site/avatar-x.webp' } }));
    expect(chrome.site.title).toBe('Ours');
    expect(chrome.avatarUrl).toBe('https://media.example/media/site/avatar-x.webp');
    expect(chrome.look.tile).toBe('square');
  });
});

describe('loadChrome stories flag', () => {
  const withMonths = { 'index/meta.json': { storyMonths: ['2024-01'], counts: { all: 0, platforms: {}, kinds: {} } } };
  it('is true only with story in kinds and a non-empty storyMonths', async () => {
    expect((await loadChrome(deps(withMonths))).stories).toBe(true);
    expect((await loadChrome(deps(withMonths, { config: resolveConfig({ kinds: ['post'] }, {}) }))).stories).toBe(false);
    expect((await loadChrome(deps({ 'index/meta.json': { storyMonths: [], counts: { all: 0, platforms: {}, kinds: {} } } }))).stories).toBe(false);
    expect((await loadChrome(deps({}))).stories).toBe(false);
  });
});

describe('loadStoryMonth', () => {
  const meta = { storyMonths: ['2024-01'], counts: { all: 0, platforms: {}, kinds: {} } };
  const month = { month: '2024-01', posts: [{ id: 'instagram_a', day: 31, cover: { src: 'media/instagram_a/0/orig.jpg' } }] };
  it('loads a listed month with media signed', async () => {
    const got = await loadStoryMonth('2024-01', deps({ 'index/meta.json': meta, 'index/stories/2024-01.json': month }));
    expect(got!.posts[0]!.cover).toMatchObject({ src: 'https://media.example/media/instagram_a/0/orig.jpg' });
  });
  it('is null for an unlisted or malformed month', async () => {
    const d = deps({ 'index/meta.json': meta, 'index/stories/2024-02.json': month });
    expect(await loadStoryMonth('2024-02', d)).toBeNull();
    expect(await loadStoryMonth('../x', d)).toBeNull();
  });
});

describe('absoluteUrl', () => {
  it('joins the configured address and a path, and is null without an address', () => {
    expect(absoluteUrl('https://site.example/', '/p/files_a')).toBe('https://site.example/p/files_a');
    expect(absoluteUrl(null, '/p/files_a')).toBeNull();
  });
});

describe('corrupt bucket JSON', () => {
  const corrupt = (bad: string[]): PageDeps =>
    deps({ 'posts/files_beach-day.json': samplePost }, {
      read: async <T,>(key: string) => {
        if (bad.includes(key)) throw new SyntaxError('Unexpected token');
        return key === 'posts/files_beach-day.json' ? (samplePost as T) : null;
      },
    });

  it('falls back to the default site and an empty chrome', async () => {
    const chrome = await loadChrome(corrupt(['_system/site.json', 'index/meta.json']));
    expect(chrome.site.title).toBe('Archive');
    expect(chrome.meta).toBeNull();
  });

  it('shows an empty grid or a missing page, not an error', async () => {
    const all = gridScope('all', undefined, config)!;
    expect(await loadGrid(all, 1, corrupt(['index/all/0001.json']))).toEqual({ page: 1, pages: 1, posts: [] });
    expect(await loadGrid(all, 2, corrupt(['index/all/0002.json']))).toBeNull();
  });

  it('treats a post that is not JSON as missing', async () => {
    expect(await loadPost('files_beach-day', 'admin', corrupt(['posts/files_beach-day.json']))).toBeNull();
  });

  it('still lets store errors through', async () => {
    const broken = deps({}, { read: async () => { throw new Error('connect ECONNREFUSED'); } });
    await expect(loadChrome(broken)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('tagPostCount', () => {
  const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ ...summaryOf(i) }));
  function summaryOf(i: number) {
    return { id: `files_${i}`, kind: 'post' as const, platform: 'files', published: '2025-01-01T00:00:00.000Z', caption: '', cover: null, count: 1, duration: null, featured: false };
  }

  it('counts a tag that fits on one page, and gives no number for a longer one', () => {
    expect(tagPostCount({ page: 1, pages: 1, posts: posts(4) })).toBe(4);
    expect(tagPostCount({ page: 1, pages: 3, posts: posts(48) })).toBeNull();
  });
});

describe('postTitle', () => {
  it("uses the caption's first line, and the site title alone without a caption", () => {
    expect(postTitle({ ...samplePost, caption: 'Beach day #summer\nmore' }, 'Site')).toBe('Beach day #summer · Site');
    expect(postTitle({ ...samplePost, caption: '' }, 'Site')).toBe('Site');
    expect(postTitle({ ...samplePost, caption: '   \n  ' }, 'Site')).toBe('Site');
    expect(postTitle({ ...samplePost, caption: 'x'.repeat(100) }, 'Site')).toBe(`${'x'.repeat(59)}… · Site`);
  });
});

describe('morePosts', () => {
  const summaryOf = (i: number) => ({ id: `files_${i}`, kind: 'post' as const, platform: 'files', published: '2025-01-01T00:00:00.000Z', caption: '', cover: null, count: 1, duration: null, featured: false });
  const page = (n: number): IndexPage => ({ page: 1, pages: 2, posts: Array.from({ length: n }, (_, i) => summaryOf(i)) });

  it('gives up to 12 other posts as a single page, without the current one', () => {
    const more = morePosts(page(20), 'files_3')!;
    expect(more.posts).toHaveLength(12);
    expect(more.posts.map((p) => p.id)).not.toContain('files_3');
    expect(more).toMatchObject({ page: 1, pages: 1 });
  });

  it('is null when there is nothing else to show', () => {
    expect(morePosts(page(1), 'files_0')).toBeNull();
    expect(morePosts(null, 'files_0')).toBeNull();
  });
});
