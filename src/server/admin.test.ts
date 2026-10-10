import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE } from '../schema/site';
import { feedNotice, loadAdminPosts } from './admin';

const sign = async (src: string) => `https://signed.example/${src}`;

describe('loadAdminPosts', () => {
  it('signs covers and keeps hidden posts', async () => {
    const index = {
      built: '2025-01-01T00:00:00.000Z',
      posts: [{ id: 'files_a', kind: 'post', platform: 'files', published: '2025-01-01T00:00:00.000Z', caption: '', cover: { type: 'image', src: 'media/files_a/0/orig.jpg', width: 1, height: 1, thumbhash: null, variants: [] }, count: 1, duration: null, featured: false, hidden: true }],
    };
    const out = await loadAdminPosts({ read: async <T,>() => index as T, sign });
    expect(out.posts[0]?.cover?.src).toBe('https://signed.example/media/files_a/0/orig.jpg');
    expect(out.posts[0]?.hidden).toBe(true);
  });

  it('is empty before the first build', async () => {
    expect((await loadAdminPosts({ read: async () => null, sign })).posts).toEqual([]);
  });
});

describe('feedNotice', () => {
  it('explains missing feeds', () => {
    expect(feedNotice({ visibility: 'public' }, { siteUrl: 'https://a.example' }, DEFAULT_SITE)).toBeNull();
    expect(feedNotice({ visibility: 'public' }, { siteUrl: null }, { ...DEFAULT_SITE, lastOrigin: 'https://a.example' })).toBeNull();
    expect(feedNotice({ visibility: 'public' }, { siteUrl: null }, DEFAULT_SITE)).toMatch(/SITE_URL/);
    expect(feedNotice({ visibility: 'password' }, { siteUrl: 'https://a.example' }, DEFAULT_SITE)).toMatch(/password/);
  });
});
