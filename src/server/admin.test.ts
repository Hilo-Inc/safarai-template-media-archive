import { describe, expect, it } from 'vitest';
import { feedNotice, HIDDEN_NOTICE, loadAdminPosts, mediaExtensionText } from './admin';

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
    expect(feedNotice({ visibility: 'public' }, { siteUrl: 'https://a.example' })).toBeNull();
    expect(feedNotice({ visibility: 'public' }, { siteUrl: null })).toMatch(/SITE_URL/);
    expect(feedNotice({ visibility: 'password' }, { siteUrl: 'https://a.example' })).toMatch(/password/);
  });
});

describe('mediaExtensionText', () => {
  it('lists exactly the extensions the importer accepts', async () => {
    const { MEDIA_EXTENSIONS } = await import('../importers/generic');
    const text = mediaExtensionText();
    for (const kind of ['image', 'video', 'audio'] as const) {
      expect(text[kind].toLowerCase().split(', ').sort()).toEqual([...MEDIA_EXTENSIONS[kind]].sort());
    }
    expect(text.image).not.toMatch(/HEIC/);
  });
});

describe('HIDDEN_NOTICE', () => {
  it('says that hidden files stay reachable by address on a public archive', () => {
    expect(HIDDEN_NOTICE).toMatch(/stay reachable/);
    expect(HIDDEN_NOTICE).not.toMatch(/unguessable/i);
  });
});
