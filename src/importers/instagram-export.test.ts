import { describe, expect, it } from 'vitest';
import { IG, instagramFiles } from '../../test/fixtures/instagram';
import { memoryFiles } from '../../test/helpers/memory-files';
import { parseExport, resolver, safeUri } from './instagram-export';

describe('safeUri', () => {
  it('keeps plain relative paths', () => {
    expect(safeUri('media/posts/202401/a.jpg')).toBe('media/posts/202401/a.jpg');
    expect(safeUri(' media/other/a.mp4 ')).toBe('media/other/a.mp4');
  });
  it('ignores escaping, absolute, URL, backslash, denied and non-string uris', () => {
    for (const bad of ['', '../a.jpg', '/a.jpg', 'https://x.invalid/a.jpg', 'data:image/png;base64,AA', 'media\\a.jpg', 'media//a.jpg', 'media/./a.jpg',
      'media/../your_instagram_activity/messages/inbox/a/p.jpg', 'your_instagram_activity/messages/inbox/a/p.jpg', 'x/personal_information/a.jpg', '__MACOSX/a.jpg', 42, null]) {
      expect(safeUri(bad), String(bad)).toBeNull();
    }
  });
});

describe('resolver', () => {
  const e = (path: string) => ({ path, size: 1, lastModified: null });
  it('matches the exact path, then a path one folder down, never a denied entry', () => {
    const find = resolver([e('part2/media/a.jpg'), e('part1/media/a.jpg'), e('media/b.jpg'), e('x/messages/media/c.jpg')]);
    expect(find('media/b.jpg')?.path).toBe('media/b.jpg');
    expect(find('media/a.jpg')?.path).toBe('part1/media/a.jpg');
    expect(find('media/c.jpg')).toBeNull();
    expect(find('media/zzz.jpg')).toBeNull();
  });
});

describe('parseExport', () => {
  it('reads only the allowlisted JSON, never IGTV or denied files', async () => {
    const files = memoryFiles(instagramFiles());
    const parsed = await parseExport(files);
    expect(files.reads.sort()).toEqual(
      ['archived_posts', 'posts', 'posts_1', 'posts_2', 'profile_photos', 'recently_deleted_content', 'reels', 'stories'].map((n) => `${IG}${n}.json`).sort(),
    );
    expect(parsed.jsonFiles.sort()).toEqual(files.reads.sort());
  });

  it('turns post entries into candidates with fixed captions and item-only fields', async () => {
    const { candidates } = await parseExport(memoryFiles(instagramFiles()));
    const posts = candidates.filter((c) => c.kind === 'post');
    expect(posts.map((c) => c.uris[0] ?? null)).toEqual([
      'media/posts/202401/c1.jpg', 'media/other/single.jpg', 'media/posts/202402/clip.mp4',
      'media/posts/202402/archived.jpg', 'media/posts/202403/deleted.jpg', null, 'media/posts/202403/draft.jpg',
    ]);
    const [carousel, single, clip] = posts;
    expect(carousel!.uris).toHaveLength(3);
    expect(carousel!.caption).toBe('Café trip 🌊 #travel');
    expect(carousel!.published).toBe('2024-01-01T10:00:00.000Z');
    expect(carousel!.coords).toEqual({ lat: 48.85, lng: 2.35 });
    expect(single!.caption).toBe('Only on the item ✨');
    expect(single!.published).toBe('2024-01-23T08:53:20.000Z');
    expect(clip!.caption).toBe('');
    expect(posts[5]).toMatchObject({ malformed: true, n: 6, uris: [] });
  });

  it('drops a record whose uris are all unsafe, without calling it malformed', async () => {
    const { candidates } = await parseExport(memoryFiles(instagramFiles()));
    expect(candidates.some((c) => c.caption === 'Escape')).toBe(false);
  });

  it('reads reels one per media item, with music and subtitles, and never the device id', async () => {
    const { candidates } = await parseExport(memoryFiles(instagramFiles()));
    const reel = candidates.find((c) => c.kind === 'reel')!;
    expect(reel).toMatchObject({ uris: ['media/other/reel.mp4'], subs: ['media/other/reel.srt'], music: 'Pop', caption: 'Reel night 🎶 #music', coords: { lat: 43.67, lng: -79.39 } });
    expect(JSON.stringify(candidates)).not.toContain('android-test-device');
  });

  it('reads stories, keeping line breaks and skipping URL uris', async () => {
    const stories = (await parseExport(memoryFiles(instagramFiles()))).candidates.filter((c) => c.kind === 'story');
    expect(stories.map((s) => s.uris[0])).toEqual(['media/other/s3.jpg', 'media/stories/202401/s2.mp4', 'media/stories/202401/s1.jpg', 'media/other/s4']);
    expect(stories[1]!.caption).toBe('Line one\nLine two');
    expect(stories[2]!.published).toBe('2024-01-31T23:30:00.000Z');
  });

  it('collects archived, deleted and draft uris, posts.json locations and the newest profile photo', async () => {
    const parsed = await parseExport(memoryFiles(instagramFiles()));
    expect([...parsed.archived]).toEqual(['media/posts/202402/archived.jpg']);
    expect([...parsed.deleted]).toEqual(['media/posts/202403/deleted.jpg']);
    expect([...parsed.drafts]).toEqual(['media/posts/202403/draft.jpg']);
    expect(parsed.locations.get('media/other/single.jpg')).toEqual({ lat: 67.9481, lng: 13.1322 });
    expect(parsed.avatar).toBe('media/other/new.jpg');
  });

  it('finds the JSON one folder down and in the first sorted part when repeated', async () => {
    const files = memoryFiles({ ...instagramFiles({ root: 'part2/' }), ...instagramFiles({ root: 'part1/' }) });
    const parsed = await parseExport(files);
    expect(parsed.jsonFiles.every((p) => p.startsWith('part1/'))).toBe(true);
    expect(parsed.candidates.length).toBeGreaterThan(0);
  });

  it('skips a file that is not valid JSON', async () => {
    const files = memoryFiles({ ...instagramFiles(), [`${IG}stories.json`]: '{nope' });
    expect((await parseExport(files)).candidates.some((c) => c.kind === 'story')).toBe(false);
  });

  it('marks a post without any timestamp as malformed', async () => {
    const files = memoryFiles({ ...instagramFiles(), [`${IG}posts_2.json`]: JSON.stringify([{ title: 'x', media: [{ uri: 'media/posts/202403/draft.jpg' }] }]) });
    const post = (await parseExport(files)).candidates.filter((c) => c.kind === 'post').at(-1)!;
    expect(post.malformed).toBe(true);
  });
});
