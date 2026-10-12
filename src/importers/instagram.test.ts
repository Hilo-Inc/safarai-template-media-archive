import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../config/load';
import { IG, instagramFiles } from '../../test/fixtures/instagram';
import { memoryFiles } from '../../test/helpers/memory-files';
import { instagramImporter as ig, UNREADABLE_EXPORT } from './instagram';

const config = resolveConfig({ preset: 'instagram' }, {});
const paths = (sel: Awaited<ReturnType<typeof ig.select>>) => (sel.ok ? sel.files.map((f) => f.path).sort() : sel.reason);
const JSON_READ = ['archived_posts', 'posts', 'posts_1', 'posts_2', 'profile_photos', 'recently_deleted_content', 'reels', 'stories'].map((n) => `${IG}${n}.json`);
const PUBLISHED = ['media/posts/202401/c1.jpg', 'media/posts/202401/c2.jpg', 'media/posts/202401/c3.mp4', 'media/other/single.jpg', 'media/posts/202402/clip.mp4', 'media/other/reel.mp4', 'media/other/reel.srt'];
const STORIES = ['media/other/s3.jpg', 'media/stories/202401/s2.mp4', 'media/stories/202401/s1.jpg', 'media/other/s4'];

describe('instagram select', () => {
  it('selects the JSON, published media, subtitles and the newest profile photo, and nothing else', async () => {
    const sel = await ig.select(memoryFiles(instagramFiles()));
    expect(paths(sel)).toEqual([...JSON_READ, ...PUBLISHED, ...STORIES, 'media/other/new.jpg'].sort());
    expect(sel).toMatchObject({ ok: true, media: 11, sidecars: 9, missing: 0 });
  });

  it('never selects IGTV, archived, deleted, draft, unreferenced or denied files, nor reads denied ones', async () => {
    const files = memoryFiles(instagramFiles());
    const chosen = paths(await ig.select(files)) as string[];
    for (const p of ['media/other/igtv.mp4', `${IG}igtv_videos.json`, 'media/posts/202402/archived.jpg', 'media/posts/202403/deleted.jpg', 'media/posts/202403/draft.jpg',
      'media/posts/202407/unreferenced.jpg', 'media/other/old.jpg', 'your_instagram_activity/messages/inbox/someone_1/photo.jpg']) expect(chosen).not.toContain(p);
    expect(files.reads.every((p) => p.startsWith(IG))).toBe(true);
  });

  it('leaves stories out when the site does not show them', async () => {
    const chosen = paths(await ig.select(memoryFiles(instagramFiles()), ['post', 'reel'])) as string[];
    for (const s of STORIES) expect(chosen).not.toContain(s);
    expect(chosen).toContain('media/posts/202401/c1.jpg');
  });

  it('counts referenced media missing from the drop, and still selects the rest', async () => {
    const sel = await ig.select(memoryFiles(instagramFiles({ omit: ['media/posts/202401/c2.jpg', 'media/other/s4'] })));
    expect(sel).toMatchObject({ ok: true, missing: 2 });
    expect(paths(sel)).toContain('media/posts/202401/c1.jpg');
  });

  it('works with the export one folder down and split across part folders', async () => {
    const one = await ig.select(memoryFiles(instagramFiles({ root: 'export/' })));
    expect(one).toMatchObject({ ok: true, missing: 0 });
    const all = instagramFiles();
    const split = Object.fromEntries(Object.entries(all).map(([p, v]) => [(p.startsWith('media/other/') ? 'part2/' : 'part1/') + p, v]));
    const sel = await ig.select(memoryFiles(split));
    expect(sel).toMatchObject({ ok: true, missing: 0 });
    expect(paths(sel)).toContain('part2/media/other/reel.mp4');
  });

  it('refuses when no record can be read', async () => {
    const sel = await ig.select(memoryFiles({ [`${IG}posts_1.json`]: '{broken', [`${IG}stories.json`]: '{"ig_stories":[]}', 'media/posts/a.jpg': { size: 1 } }));
    expect(sel).toEqual({ ok: false, reason: UNREADABLE_EXPORT });
  });
});

describe('instagram admit', () => {
  const e = (path: string) => ({ path, size: 1, lastModified: null });
  it('keeps allowlisted JSON and media, never denied paths or other JSON', () => {
    const sel = ig.admit!([e(`${IG}posts_1.json`), e(`${IG}igtv_videos.json`), e('media/posts/a.jpg'), e('media/other/r.srt'), e('your_instagram_activity/messages/inbox/a/p.jpg'), e('notes.txt')]);
    expect(sel.ok && sel.files.map((f) => f.path)).toEqual([`${IG}posts_1.json`, 'media/posts/a.jpg', 'media/other/r.srt']);
  });
  const admitted = (...paths: string[]) => {
    const sel = ig.admit!([e(`${IG}posts_1.json`), ...paths.map(e)]);
    return sel.ok ? sel.files.map((f) => f.path).filter((p) => p !== `${IG}posts_1.json`) : sel.reason;
  };
  it('admits extensionless files only from media folders', () => {
    expect(admitted('your_instagram_activity/likes/liked_posts')).toEqual([]);
    expect(admitted('media/other/s4', 'export/Media/other/s5')).toEqual(['media/other/s4', 'export/Media/other/s5']);
  });
  it('never admits subtitles in denied folders, junk entries, or allowlisted JSON names under a denied parent', () => {
    expect(admitted('your_instagram_activity/messages/inbox/a/x.srt', 'your_instagram_activity/messages/inbox/a/x.vtt')).toEqual([]);
    expect(admitted('__MACOSX/a.jpg', 'media/._a.jpg')).toEqual([]);
    expect(admitted('messages/your_instagram_activity/media/posts_1.json')).toEqual([]);
  });
  it('refuses exports that are not Instagram JSON', () => {
    expect(ig.admit!([e('your_facebook_activity/posts/x.json')])).toMatchObject({ ok: false, reason: expect.stringContaining('Instagram or Facebook export') });
    expect(ig.admit!([e('your_instagram_activity/media/posts_1.html')])).toMatchObject({ ok: false, reason: expect.stringContaining('HTML version') });
    expect(ig.admit!([e('a.jpg')])).toMatchObject({ ok: false });
  });
});

describe('instagram read', () => {
  const read = async (cfg = config, root = '') => {
    const files = memoryFiles(instagramFiles({ root }));
    const sel = await ig.select(files);
    if (!sel.ok) throw new Error(sel.reason);
    const keep = new Set(sel.files.map((f) => f.path));
    return ig.read({ entries: files.entries.filter((x) => keep.has(x.path)), readText: files.readText }, cfg);
  };

  it('builds posts, a carousel in order, with ids from the first file stem', async () => {
    const raws = await read();
    const c1 = raws.find((r) => r.id === 'c1')!;
    expect(c1).toMatchObject({ platform: 'instagram', kind: 'post', caption: 'Café trip 🌊 #travel', tags: ['travel'], published: '2024-01-01T10:00:00.000Z' });
    expect(c1.media.map((m) => m.path)).toEqual(['media/posts/202401/c1.jpg', 'media/posts/202401/c2.jpg', 'media/posts/202401/c3.mp4']);
    expect(raws.map((r) => r.id)).toEqual(['c1', 'single', 'clip', 'archived', 'deleted', 'malformed-post-6', 'draft', 'reel', 's3', 's2', 's1', 's4']);
  });

  it('marks archived, deleted and draft posts so they are never published', async () => {
    const raws = await read();
    expect(raws.find((r) => r.id === 'archived')!.state).toBe('archived');
    expect(raws.find((r) => r.id === 'deleted')!.state).toBe('deleted');
    expect(raws.find((r) => r.id === 'draft')!.state).toBe('draft');
    expect(raws.find((r) => r.id === 'c1')!.state).toBeUndefined();
  });

  it('turns a malformed record into an empty post the runner reports', async () => {
    expect((await read()).find((r) => r.id === 'malformed-post-6')).toMatchObject({ kind: 'post', media: [] });
  });

  it('gives reels music and subtitles, and stories their kind and line breaks', async () => {
    const raws = await read();
    expect(raws.find((r) => r.id === 'reel')).toMatchObject({ kind: 'reel', music: { genre: 'Pop' }, media: [{ path: 'media/other/reel.mp4', subtitles: [{ path: 'media/other/reel.srt', lang: null }] }] });
    expect(raws.find((r) => r.id === 's2')).toMatchObject({ kind: 'story', caption: 'Line one\nLine two' });
  });

  it('carries location only when the config keeps it, preferring posts.json', async () => {
    expect((await read()).every((r) => !r.location)).toBe(true);
    const raws = await read(resolveConfig({ preset: 'instagram', location: 'exact' }, {}));
    expect(raws.find((r) => r.id === 'single')!.location).toEqual({ lat: 67.9481, lng: 13.1322 });
    expect(raws.find((r) => r.id === 'c1')!.location).toEqual({ lat: 48.85, lng: 2.35 });
  });

  it('keeps present media and resolves paths one folder down', async () => {
    const raws = await read(config, 'export/');
    expect(raws.find((r) => r.id === 'c1')!.media[0]!.path).toBe('export/media/posts/202401/c1.jpg');
  });

  it('keeps the first referenced path when none of a post’s media was dropped', async () => {
    const files = memoryFiles(instagramFiles({ omit: ['media/posts/202402/clip.mp4'] }));
    const raws = await ig.read(files, config);
    expect(raws.find((r) => r.id === 'clip')!.media).toEqual([{ path: 'media/posts/202402/clip.mp4' }]);
  });

  it('makes a repeated stem unique', async () => {
    const json = JSON.stringify([
      { title: 'a', creation_timestamp: 1, media: [{ uri: 'media/posts/1/x.jpg' }] },
      { title: 'b', creation_timestamp: 2, media: [{ uri: 'media/posts/2/x.jpg' }] },
    ]);
    const files = memoryFiles({ [`${IG}posts_1.json`]: json, 'media/posts/1/x.jpg': { size: 1 }, 'media/posts/2/x.jpg': { size: 1 } });
    const ids = (await ig.read(files, config)).map((r) => r.id);
    expect(ids[0]).toBe('x');
    expect(ids[1]).toMatch(/^x-[0-9a-f]{8}$/);
  });

  it('finds the newest profile photo for the avatar', async () => {
    expect(await ig.avatar!(memoryFiles(instagramFiles({ root: 'p/' })))).toBe('p/media/other/new.jpg');
  });
});
