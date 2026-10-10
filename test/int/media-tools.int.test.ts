import { mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audioPeaks, imageVariants, posterFrame, thumbhashOf, toVtt } from '../../src/indexer/derive';
import { run } from '../../src/indexer/exec';
import { avOutput, detectType, probeAv, probeImage } from '../../src/indexer/probe';
import { stripAv, stripImage } from '../../src/indexer/strip';
import { makeAudio, makeJpeg, makeMp4, SRT } from '../helpers/media';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tools-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exif = async (file: string) => JSON.parse((await run('exiftool', ['-j', '-n', file])).stdout)[0] as Record<string, unknown>;
const ffTags = async (file: string) => {
  const out = JSON.parse((await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])).stdout);
  return JSON.stringify([out.format.tags ?? {}, ...out.streams.map((s: { tags?: object }) => s.tags ?? {})]);
};

describe('detect and probe', () => {
  it('detects an extensionless JPEG and reads its display size', async () => {
    const file = join(dir, 'IMG_0001');
    await makeJpeg(file, { width: 400, height: 300, orientation: 6 });
    expect(await detectType(file)).toEqual({ type: 'image', ext: 'jpg', mime: 'image/jpeg' });
    expect(await probeImage(file)).toEqual({ width: 300, height: 400 });
  });

  it('reads a rotated video as portrait', async () => {
    const file = join(dir, 'rot.mp4');
    await makeMp4(file, { width: 320, height: 180, rotate: 90 });
    const p = await probeAv(file);
    expect([p.width, p.height, p.hasVideo]).toEqual([180, 320, true]);
  });

  it('reads an MP3 as audio', async () => {
    const file = join(dir, 'tone.mp3');
    await makeAudio(file, 2);
    const det = await detectType(file);
    const p = await probeAv(file);
    expect(det.type).toBe('av');
    expect(p.hasVideo).toBe(false);
    expect(p.duration).toBeGreaterThan(1.5);
    expect(avOutput(p, det).ext).toBe('mp3');
  });

  it('refuses a text file', async () => {
    const file = join(dir, 'notes');
    await writeFile(file, 'hello there');
    await expect(detectType(file)).rejects.toThrow('Unrecognised file type');
  });
});

describe('stripping', () => {
  it('removes GPS and camera tags from an image and keeps its orientation', async () => {
    const src = join(dir, 'gps.jpg');
    await makeJpeg(src, { width: 200, height: 100, orientation: 6 });
    expect((await exif(src)).GPSLatitude).toBeDefined();
    const dest = join(dir, 'gps-clean.jpg');
    await stripImage(src, dest);
    const tags = await exif(dest);
    expect(tags.GPSLatitude).toBeUndefined();
    expect(tags.Make).toBeUndefined();
    expect(tags.Orientation).toBe(6);
  });

  it('fails instead of publishing when exiftool cannot write the file', async () => {
    const src = join(dir, 'broken.jpg');
    await writeFile(src, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
    await expect(stripImage(src, join(dir, 'broken-out.jpg'))).rejects.toThrow('exiftool could not process this file');
  });

  it('removes MP4 metadata, moves moov to the front and keeps rotation', async () => {
    const src = join(dir, 'meta.mov');
    await makeMp4(src, { width: 320, height: 180, rotate: 90 });
    expect(await ffTags(src)).toContain('private title');
    const probe = await probeAv(src);
    const out = avOutput(probe, { type: 'av', ext: 'mov', mime: 'video/quicktime' });
    const dest = join(dir, `meta-clean.${out.ext}`);
    await stripAv(src, dest, probe, out);
    const tags = await ffTags(dest);
    expect(tags).not.toContain('private title');
    expect(tags).not.toContain('48.8566');
    const after = await probeAv(dest);
    expect([after.width, after.height]).toEqual([180, 320]);
    // +faststart puts the moov box (the index) before mdat (the media data).
    const bytes = (await readFile(dest)).toString('latin1');
    expect(bytes.indexOf('moov')).toBeGreaterThan(-1);
    expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'));
  });

  it('removes tags from audio', async () => {
    const src = join(dir, 'tagged.mp3');
    await makeAudio(src, 1);
    const probe = await probeAv(src);
    const dest = join(dir, 'tagged-clean.mp3');
    await stripAv(src, dest, probe, avOutput(probe, { type: 'av', ext: 'mp3', mime: 'audio/mpeg' }));
    expect(await ffTags(dest)).not.toContain('private');
  });
});

describe('derived files', () => {
  it('makes variants without upscaling, and a thumbhash', async () => {
    const src = join(dir, 'wide.jpg');
    await makeJpeg(src, { width: 1000, height: 500, gps: false });
    const variants = await imageVariants(src, dir, 1000);
    expect(variants.map((v) => v.name)).toEqual(['w320.webp', 'w640.webp', 'w1000.webp']);
    expect((await sharp(variants[2]!.file).metadata()).width).toBe(1000);
    expect(await thumbhashOf(src)).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('makes an upright poster with variants', async () => {
    const src = join(dir, 'poster-src.mp4');
    await makeMp4(src, { width: 320, height: 180, rotate: 90, seconds: 3 });
    const poster = await posterFrame(src, dir, 3);
    expect([poster.width, poster.height]).toEqual([180, 320]);
    expect(poster.variants.map((v) => v.name)).toEqual(['poster-w180.webp']);
  });

  it('computes 1000 peaks between 0 and 1', async () => {
    const src = join(dir, 'peaks.mp3');
    await makeAudio(src, 3);
    const peaks = await audioPeaks(src, 3);
    expect(peaks).toHaveLength(1000);
    expect(Math.max(...peaks)).toBe(1);
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0);
  });

  it('converts SRT to WebVTT', async () => {
    const src = join(dir, 'subs.srt');
    await writeFile(src, SRT);
    const dest = join(dir, 'subs.vtt');
    await toVtt(src, dest);
    const vtt = await readFile(dest, 'utf8');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    // ffmpeg 5.1 drops a zero hour (00:01.000); newer versions keep it. Both are valid WebVTT.
    expect(vtt).toMatch(/(00:)?00:01\.000 --> (00:)?00:02\.000/);
    await copyFile(dest, join(dir, 'again.vtt'));
    await toVtt(join(dir, 'again.vtt'), join(dir, 'again-out.vtt'));
    expect(await readFile(join(dir, 'again-out.vtt'), 'utf8')).toContain('World');
  });
});
