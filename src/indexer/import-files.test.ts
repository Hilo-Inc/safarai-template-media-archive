import { describe, expect, it } from 'vitest';
import type { Store } from '../lib/store';
import { MAX_TEXT_BYTES } from '../importers/text';
import { inboxImportFiles, isNormalPath } from './import-files';

describe('MAX_TEXT_BYTES', () => {
  it('lets a large posts.json through (the real one is several MB)', () => {
    expect(MAX_TEXT_BYTES).toBe(32 * 1024 * 1024);
  });
});

describe('isNormalPath', () => {
  it('accepts plain relative forward-slash paths', () => {
    for (const p of ['a.jpg', 'Camera/beach.jpg', 'a b/c d.mp4', '.hidden/x.jpg', 'a/..b/c', 'a/b.']) expect(isNormalPath(p)).toBe(true);
  });
  it('rejects anything not already normalised', () => {
    const bad = ['', '/a.jpg', 'a//b.jpg', './a.jpg', 'a/./b.jpg', '../a.jpg', 'a/../b.jpg', 'a/..', 'a/', 'a\\b.jpg', 'a\u0000b', 'a\nb'];
    for (const p of bad) expect(isNormalPath(p), JSON.stringify(p)).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isNormalPath(42 as never)).toBe(false);
  });
});

describe('inboxImportFiles', () => {
  it('skips bucket keys that are not normalised paths (the S3 test server will not store them)', async () => {
    const at = new Date(0);
    const keys = ['inbox/ok.jpg', 'inbox/trip/a.jpg', 'inbox/a//b.jpg', 'inbox/x\\y.jpg', 'inbox/./c.jpg', 'inbox/d/../e.jpg', 'inbox/../f.jpg', 'inbox/dir/', 'inbox/'];
    const store = { list: async () => keys.map((key) => ({ key, size: 1, lastModified: at })) } as unknown as Store;
    const files = await inboxImportFiles(store);
    expect(files.entries.map((e) => e.path)).toEqual(['ok.jpg', 'trip/a.jpg']);
  });
});
