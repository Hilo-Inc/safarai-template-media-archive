import { describe, expect, it } from 'vitest';
import { encodeKey, keys, pageName } from './keys';

describe('keys', () => {
  it('builds the bucket layout', () => {
    expect(keys.post('files_a')).toBe('posts/files_a.json');
    expect(keys.media('files_a', 0, 'orig.jpg')).toBe('media/files_a/0/orig.jpg');
    expect(keys.importPrefix('abc')).toBe('imports/abc/');
    expect(keys.importStatus('abc')).toBe('_system/imports/abc.json');
    expect(keys.indexPage('all', 1)).toBe('index/all/0001.json');
    expect(keys.indexPage('kind/video', 12)).toBe('index/kind/video/0012.json');
    expect(keys.storyMonth('2025-02')).toBe('index/stories/2025-02.json');
    expect(keys.avatar('lz3k')).toBe('media/site/avatar-lz3k.webp');
  });

  it('pads page numbers to four digits', () => {
    expect(pageName(7)).toBe('0007.json');
    expect(pageName(12345)).toBe('12345.json');
  });

  it('encodes each key segment for a URL', () => {
    expect(encodeKey('index/tag/café/0001.json')).toBe('index/tag/caf%C3%A9/0001.json');
    expect(encodeKey('media/a b/0/orig.jpg')).toBe('media/a%20b/0/orig.jpg');
  });
});
