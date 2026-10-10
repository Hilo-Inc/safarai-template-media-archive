import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../config/load';
import { memoryFiles } from '../../test/helpers/memory-files';
import { genericImporter } from './generic';

const config = resolveConfig({}, {});
const mb = 1024 * 1024;

describe('generic select', () => {
  it('selects media, their sidecars and subtitles, and skips the rest', async () => {
    const listing = memoryFiles({
      'yt/Clip [abc123].mp4': { size: 5 * mb },
      'yt/Clip [abc123].info.json': '{}',
      'yt/Clip [abc123].en.vtt': 'WEBVTT',
      'yt/Clip [abc123].description': 'text',
      'gallery/123_1.jpg': { size: mb },
      'gallery/123_1.jpg.json': '{}',
      'music/song.mp3': { size: 3 * mb },
      'misc/notes.txt': 'hi',
      'misc/data.json': '{}',
      'raw/IMG_0001': { size: mb },
      '__MACOSX/yt/._Clip [abc123].mp4': { size: 1 },
      'yt/.DS_Store': { size: 1 },
    });
    const sel = await genericImporter.select(listing);
    expect(sel.ok).toBe(true);
    if (!sel.ok) return;
    expect(sel.files.map((f) => f.path).sort()).toEqual([
      'gallery/123_1.jpg',
      'gallery/123_1.jpg.json',
      'music/song.mp3',
      'raw/IMG_0001',
      'yt/Clip [abc123].en.vtt',
      'yt/Clip [abc123].info.json',
      'yt/Clip [abc123].mp4',
    ]);
    expect(sel.media).toBe(4);
    expect(sel.sidecars).toBe(3);
    expect(listing.reads).toEqual([]);
  });

  it('never selects denied folders', async () => {
    const sel = await genericImporter.select(
      memoryFiles({ 'messages/photos/a.jpg': { size: 1 }, 'export/personal_information/pic.png': { size: 1 }, 'ok/b.jpg': { size: 1 } }),
    );
    expect(sel.ok && sel.files.map((f) => f.path)).toEqual(['ok/b.jpg']);
  });

  it('refuses a Meta export and an empty selection', async () => {
    const meta = await genericImporter.select(
      memoryFiles({ 'your_instagram_activity/media/posts_1.json': '[]', 'media/posts/202501/a.jpg': { size: 1 } }),
    );
    expect(meta).toEqual({
      ok: false,
      reason: 'This looks like an Instagram or Facebook export. Its importer arrives in a later update; nothing was uploaded.',
    });
    expect(await genericImporter.select(memoryFiles({ 'a.txt': 'x' }))).toEqual({
      ok: false,
      reason: 'No photos, videos or audio files were found.',
    });
  });
});

describe('generic read', () => {
  it('reads a yt-dlp video with its info JSON and subtitles', async () => {
    const info = {
      id: 'abc123',
      title: 'Clip title',
      description: 'About #Travel',
      timestamp: 1739188800,
      webpage_url: 'https://www.youtube.com/watch?v=abc123',
      extractor_key: 'Youtube',
      tags: ['Vlog'],
    };
    const posts = await genericImporter.read(
      memoryFiles({
        'yt/Clip [abc123].mp4': { size: 10 },
        'yt/Clip [abc123].info.json': JSON.stringify(info),
        'yt/Clip [abc123].en.vtt': 'WEBVTT',
        'yt/Clip [abc123].srt': '1',
      }),
      config,
    );
    expect(posts).toEqual([
      {
        platform: 'youtube',
        id: 'abc123',
        published: '2025-02-10T12:00:00.000Z',
        caption: 'Clip title\n\nAbout #Travel',
        tags: ['vlog', 'travel'],
        sourceUrl: 'https://www.youtube.com/watch?v=abc123',
        location: null,
        music: null,
        media: [
          {
            path: 'yt/Clip [abc123].mp4',
            subtitles: [
              { path: 'yt/Clip [abc123].en.vtt', lang: 'en' },
              { path: 'yt/Clip [abc123].srt', lang: null },
            ],
          },
        ],
      },
    ]);
  });

  it('uses upload_date when there is no timestamp, and SoundCloud genre as music', async () => {
    const [post] = await genericImporter.read(
      memoryFiles({
        'sc/song.mp3': { size: 10 },
        'sc/song.info.json': JSON.stringify({ id: '991', title: 'Song', upload_date: '20240301', extractor: 'soundcloud', genre: 'Ambient' }),
      }),
      config,
    );
    expect(post).toMatchObject({ platform: 'soundcloud', id: '991', published: '2024-03-01T00:00:00.000Z', music: { genre: 'Ambient' } });
  });

  it('groups gallery-dl files of one post in num order', async () => {
    const meta = (num: number) => JSON.stringify({ category: 'instagram', shortcode: 'C0de', num, date: '2025-01-05 10:20:30', description: 'Two pics' });
    const [post] = await genericImporter.read(
      memoryFiles({
        'g/C0de_2.jpg': { size: 1 },
        'g/C0de_2.jpg.json': meta(2),
        'g/C0de_1.jpg': { size: 1 },
        'g/C0de_1.jpg.json': meta(1),
      }),
      config,
    );
    expect(post).toMatchObject({
      platform: 'instagram',
      id: 'C0de',
      published: '2025-01-05T10:20:30.000Z',
      caption: 'Two pics',
      media: [{ path: 'g/C0de_1.jpg' }, { path: 'g/C0de_2.jpg' }],
    });
  });

  it('turns files without sidecars into one post each, dated by the file', async () => {
    const posts = await genericImporter.read(
      memoryFiles({ 'pics/beach.jpg': { size: 1, lastModified: Date.UTC(2023, 6, 1) }, 'raw/IMG_0001': { size: 1 } }),
      config,
    );
    expect(posts.map((p) => [p.platform, p.id])).toEqual([
      ['files', 'beach'],
      ['files', 'IMG_0001'],
    ]);
    expect(posts[0]!.published).toBe('2023-07-01T00:00:00.000Z');
    expect(posts[0]!.caption).toBe('');
  });

  it('keeps duplicate stems apart', async () => {
    const posts = await genericImporter.read(memoryFiles({ 'a/photo.jpg': { size: 1 }, 'b/photo.jpg': { size: 1 }, 'c/photo.png': { size: 1 } }), config);
    const ids = posts.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('photo');
    expect(ids[1]).toMatch(/^photo-[0-9a-f]{8}$/);
    expect(ids[2]).toMatch(/^photo-[0-9a-f]{8}$/);
  });

  it('keeps a place name only when location is allowed', async () => {
    const files = {
      'v/a.mp4': { size: 1 },
      'v/a.info.json': JSON.stringify({ id: 'a1', title: 'A', timestamp: 0, extractor: 'youtube', location: 'Lisbon' }),
    };
    expect((await genericImporter.read(memoryFiles(files), config))[0]!.location).toBeNull();
    const place = resolveConfig({ location: 'place' }, {});
    expect((await genericImporter.read(memoryFiles(files), place))[0]!.location).toEqual({ name: 'Lisbon' });
  });

  it('ignores a sidecar that is not valid JSON', async () => {
    const [post] = await genericImporter.read(memoryFiles({ 'v/a.mp4': { size: 1 }, 'v/a.info.json': '{nope' }), config);
    expect(post).toMatchObject({ platform: 'files', id: 'a' });
  });
});
