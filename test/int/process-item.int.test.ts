import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../src/indexer/exec';
import { DISK_MESSAGE, processItem } from '../../src/indexer/process-item';
import { makeAudio, makeJpeg, makeMp4, SRT } from '../helpers/media';
import { testStore } from '../helpers/s3';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'item-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const names = async (s: ReturnType<typeof testStore>, prefix: string) => (await s.list(prefix)).map((o) => o.key.slice(prefix.length)).sort();

describe('processItem', () => {
  it('imports an extensionless JPEG, upright, with GPS stripped', async () => {
    const s = testStore('item-jpeg');
    const file = join(dir, 'IMG_0001');
    await makeJpeg(file, { width: 400, height: 300, orientation: 6 });
    const result = await processItem({ postId: 'files_img', n: 0, file, alt: 'A wall', subtitles: [], workDir: dir }, s);
    expect(result).toEqual({
      ok: true,
      item: {
        type: 'image',
        src: 'media/files_img/0/orig.jpg',
        width: 300,
        height: 400,
        orientation: 'portrait',
        alt: 'A wall',
        thumbhash: expect.any(String),
        variants: [{ w: 300, src: 'media/files_img/0/w300.webp' }],
      },
    });
    expect(await names(s, 'media/files_img/0/')).toEqual(['orig.jpg', 'w300.webp']);
    const local = join(dir, 'downloaded.jpg');
    await s.download('media/files_img/0/orig.jpg', local);
    const tags = JSON.parse((await run('exiftool', ['-j', '-n', local])).stdout)[0];
    expect(tags.GPSLatitude).toBeUndefined();
    expect(tags.Make).toBeUndefined();
    expect(tags.Orientation).toBe(6);
  });

  it('imports a rotated phone video with a poster and subtitles', async () => {
    const s = testStore('item-video');
    const file = join(dir, 'clip.mov');
    await makeMp4(file, { width: 320, height: 180, rotate: 90, seconds: 3 });
    const srt = join(dir, 'clip.en.srt');
    await writeFile(srt, SRT);
    const result = await processItem(
      { postId: 'files_clip', n: 1, file, alt: null, subtitles: [{ file: srt, lang: 'en' }], workDir: dir },
      s,
    );
    expect(result.ok).toBe(true);
    const item = (result as { item: Record<string, unknown> }).item;
    expect(item).toMatchObject({
      type: 'video',
      src: 'media/files_clip/1/orig.mp4',
      width: 180,
      height: 320,
      orientation: 'portrait',
      playable: true,
      poster: { src: 'media/files_clip/1/poster.webp', width: 180, height: 320, variants: [{ w: 180, src: 'media/files_clip/1/poster-w180.webp' }] },
      subtitles: [{ src: 'media/files_clip/1/subs.en.vtt', lang: 'en' }],
    });
    expect(item.duration).toBeGreaterThan(2.5);
    expect(await names(s, 'media/files_clip/1/')).toEqual(['orig.mp4', 'poster-w180.webp', 'poster.webp', 'subs.en.vtt']);
  });

  it('marks an unplayable codec and keeps its container', async () => {
    const s = testStore('item-avi');
    const file = join(dir, 'old.avi');
    await makeMp4(file, { width: 320, height: 240, codec: 'mpeg4' });
    const result = await processItem({ postId: 'files_old', n: 0, file, alt: null, subtitles: [], workDir: dir }, s);
    expect(result).toMatchObject({ ok: true, item: { type: 'video', src: 'media/files_old/0/orig.avi', playable: false, orientation: 'landscape' } });
    expect((result as { item: { poster: unknown } }).item.poster).not.toBeNull();
  });

  it('imports audio with 1000 peaks', async () => {
    const s = testStore('item-audio');
    const file = join(dir, 'song.mp3');
    await makeAudio(file, 2);
    const result = await processItem({ postId: 'files_song', n: 0, file, alt: null, subtitles: [], workDir: dir }, s);
    expect(result).toMatchObject({ ok: true, item: { type: 'audio', src: 'media/files_song/0/orig.mp3', peaks: 'media/files_song/0/peaks.json' } });
    expect(await s.getJson<number[]>('media/files_song/0/peaks.json')).toHaveLength(1000);
  });

  it('fails the item when the disk is too full, before uploading anything', async () => {
    const s = testStore('item-disk');
    const file = join(dir, 'big.jpg');
    await makeJpeg(file, { width: 100, height: 100 });
    const result = await processItem({ postId: 'files_big', n: 0, file, alt: null, subtitles: [], workDir: dir }, s, {
      freeBytes: async () => 10,
    });
    expect(result).toEqual({ ok: false, reason: DISK_MESSAGE });
    expect(await s.list('media/')).toEqual([]);
  });

  it('fails a file that is not media, and a corrupt image, without uploading', async () => {
    const s = testStore('item-bad');
    const text = join(dir, 'notes');
    await writeFile(text, 'just some words');
    expect(await processItem({ postId: 'files_notes', n: 0, file: text, alt: null, subtitles: [], workDir: dir }, s)).toEqual({
      ok: false,
      reason: 'Unrecognised file type',
    });
    const broken = join(dir, 'broken.jpg');
    await writeFile(broken, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]));
    const result = await processItem({ postId: 'files_broken', n: 0, file: broken, alt: null, subtitles: [], workDir: dir }, s);
    expect(result.ok).toBe(false);
    expect(await s.list('media/')).toEqual([]);
  });

  it('fails only that item when the input file has vanished', async () => {
    const s = testStore('item-vanished');
    const result = await processItem({ postId: 'files_gone', n: 0, file: join(dir, 'does-not-exist'), alt: null, subtitles: [], workDir: dir }, s);
    expect(result).toEqual({ ok: false, reason: 'The file could not be processed' });
    expect(await s.list('media/files_gone/')).toEqual([]);
  });
});
