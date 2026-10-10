import { describe, expect, it } from 'vitest';
import { baseName, dirName, extOf, hashtags, safePlatform, shortHash, slugId } from './text';

describe('hashtags', () => {
  it('collects unique lowercase tags, including non-Latin letters', () => {
    expect(hashtags('Sun #Summer and #summer, #café #夏 #a_b #1')).toEqual(['summer', 'café', '夏', 'a_b', '1']);
    expect(hashtags('no tags')).toEqual([]);
  });
});

describe('slugId', () => {
  it('keeps safe characters and limits length', () => {
    expect(slugId('Holiday Video [dQw4w9WgXcQ]')).toBe('Holiday-Video-dQw4w9WgXcQ');
    expect(slugId('../../etc/passwd')).toBe('etc-passwd');
    expect(slugId('x'.repeat(100))).toHaveLength(80);
    expect(slugId('###')).toBe('x');
  });
});

describe('safePlatform', () => {
  it('lowercases and falls back to files', () => {
    expect(safePlatform('TikTok')).toBe('tiktok');
    expect(safePlatform('Youtube:Tab')).toBe('youtube');
    expect(safePlatform('all')).toBe('files');
    expect(safePlatform('tag')).toBe('files');
    expect(safePlatform('weird site!')).toBe('files');
    expect(safePlatform(undefined)).toBe('files');
  });
});

describe('path helpers and hash', () => {
  it('splits paths', () => {
    expect(extOf('a/b/Clip.MP4')).toBe('mp4');
    expect(extOf('a/b/noext')).toBe('');
    expect(extOf('a/.hidden')).toBe('');
    expect(baseName('a/b/c.mp4')).toBe('c.mp4');
    expect(dirName('a/b/c.mp4')).toBe('a/b');
    expect(dirName('c.mp4')).toBe('');
  });

  it('hashes to 8 hex characters, stable', async () => {
    expect(await shortHash('a/b.jpg')).toMatch(/^[0-9a-f]{8}$/);
    expect(await shortHash('a/b.jpg')).toBe(await shortHash('a/b.jpg'));
    expect(await shortHash('a/b.jpg')).not.toBe(await shortHash('c/b.jpg'));
  });
});
