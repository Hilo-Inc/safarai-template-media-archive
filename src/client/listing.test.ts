import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { isNormalPath } from '../indexer/import-files';
import { MAX_TEXT_BYTES } from '../importers/text';
import { MAX_PATH_LENGTH } from '../lib/upload-key';
import { batches, chunkSize, listFiles, listFilesNamingZip, MAX_PATH, MIN_PART, normalizePath, planUploads, sourceListing, toEntries, type Source } from './listing';

async function zip(name: string, files: Record<string, string>): Promise<File> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const [path, text] of Object.entries(files)) await writer.add(path, new TextReader(text));
  return new File([await writer.close()], name, { type: 'application/zip' });
}

const source = (path: string, size: number): Source => ({ path, size, lastModified: null, blob: async () => new Blob(['x'.repeat(size)]) });

describe('normalizePath', () => {
  it.each([
    ['a/b.jpg', 'a/b.jpg'],
    ['a\\b.jpg', 'a/b.jpg'],
    ['/a//b.jpg', 'a/b.jpg'],
    ['./a/./b.jpg', 'a/b.jpg'],
    ['a/../b.jpg', null],
    ['', null],
    ['/', null],
  ])('%j → %j', (raw, expected) => {
    expect(normalizePath(raw)).toBe(expected);
  });

  it('returns null for paths the server would refuse (control characters, too long)', () => {
    expect(normalizePath('a/b\u0000.jpg')).toBeNull();
    expect(normalizePath('a/\u001fb.jpg')).toBeNull();
    expect(normalizePath('a/b\u007f.jpg')).toBeNull();
    expect(normalizePath('a'.repeat(MAX_PATH_LENGTH + 1))).toBeNull();
    expect(normalizePath('a'.repeat(MAX_PATH_LENGTH))).not.toBeNull();
  });

  it('keeps the same length limit as the server', () => {
    expect(MAX_PATH).toBe(MAX_PATH_LENGTH);
  });

  it('only produces paths the server accepts (isNormalPath)', () => {
    const raws = ['a/b.jpg', 'a\\b.jpg', '/a//b.jpg', './a/./b.jpg', 'a/../b.jpg', '', '/', 'a/b\u0001', 'x/\u007f', '//', 'a/./', 'U\u00fcn/c\u00f8d\u00e9 1.jpg', 'a b/c#d?.jpg'];
    for (const raw of raws) {
      const out = normalizePath(raw);
      if (out !== null) expect(isNormalPath(out), JSON.stringify(raw)).toBe(true);
    }
    expect(raws.map(normalizePath).filter((p) => p !== null).length).toBeGreaterThan(5);
  });
});

describe('listFiles', () => {
  it('lists zip entries and loose files, skipping folders', async () => {
    const z = await zip('export.zip', { 'media/a.jpg': 'aaa', 'media/b.json': '{}' });
    const loose = new File(['hello'], 'c.jpg', { lastModified: 5 });
    const { sources } = await listFiles([z, loose]);
    expect(toEntries(sources)).toEqual([
      { path: 'media/a.jpg', size: 3, lastModified: expect.any(Number) },
      { path: 'media/b.json', size: 2, lastModified: expect.any(Number) },
      { path: 'c.jpg', size: 5, lastModified: 5 },
    ]);
    expect(await (await sources.get('media/a.jpg')!.blob()).text()).toBe('aaa');
  });

  it('merges the parts of a split export, first copy wins', async () => {
    const one = await zip('part1.zip', { 'media/a.jpg': 'one', 'shared.json': 'first' });
    const two = await zip('part2.zip', { 'media/b.jpg': 'two', 'shared.json': 'second' });
    const { sources, duplicates } = await listFiles([one, two]);
    expect([...sources.keys()].sort()).toEqual(['media/a.jpg', 'media/b.jpg', 'shared.json']);
    expect(duplicates).toBe(1);
    expect(await (await sources.get('shared.json')!.blob()).text()).toBe('first');
  });

  it('uses the folder path of files from a folder picker', async () => {
    const f = new File(['x'], 'a.jpg');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'trip/day1/a.jpg' });
    const { sources } = await listFiles([f]);
    expect([...sources.keys()]).toEqual(['trip/day1/a.jpg']);
  });
});

describe('planUploads', () => {
  const files = [
    { path: 'a.jpg', size: 3, lastModified: null },
    { path: 'b.jpg', size: 4, lastModified: null },
    { path: 'c.jpg', size: 5, lastModified: null },
    { path: 'd.jpg', size: 6, lastModified: null },
  ];

  it('skips files already uploaded', () => {
    const sources = new Map(files.map((f) => [f.path, source(f.path, f.size)]));
    const plan = planUploads(files, [{ path: 'a.jpg', size: 3 }, { path: 'b.jpg', size: 4 }], sources);
    expect(plan.todo.map((s) => s.path)).toEqual(['c.jpg', 'd.jpg']);
    expect(plan).toMatchObject({ done: 2, doneBytes: 7, missing: [] });
  });

  it('uploads again a file whose upload stopped part way', () => {
    const sources = new Map(files.map((f) => [f.path, source(f.path, f.size)]));
    const plan = planUploads(files, [{ path: 'a.jpg', size: 1 }], sources);
    expect(plan.todo.map((s) => s.path)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
  });

  it('reports files that were not dropped again, or changed size', () => {
    const sources = new Map([['a.jpg', source('a.jpg', 3)], ['b.jpg', source('b.jpg', 99)]]);
    const plan = planUploads(files, [], sources);
    expect(plan.todo.map((s) => s.path)).toEqual(['a.jpg']);
    expect(plan.missing).toEqual(['b.jpg', 'c.jpg', 'd.jpg']);
  });
});

describe('chunkSize and batches', () => {
  it('uses 16 MB parts, larger only to stay under 9,000 parts', () => {
    expect(chunkSize(10)).toBe(MIN_PART);
    expect(chunkSize(500 * 1024 ** 3) * 9000).toBeGreaterThanOrEqual(500 * 1024 ** 3);
  });

  it('groups files up to the byte limit; a large file is a batch of its own', () => {
    const out = batches([source('a', 4), source('b', 4), source('c', 10), source('d', 1)], 8);
    expect(out.map((b) => b.map((s) => s.path))).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});

describe('listFilesNamingZip', () => {
  it('names the zip that cannot be read', async () => {
    const good = await zip('good.zip', { 'a.jpg': 'a' });
    const bad = new File(['this is not a zip'], 'broken.zip', { type: 'application/zip' });
    await expect(listFilesNamingZip([good, bad])).rejects.toThrow('broken.zip');
    expect([...(await listFilesNamingZip([good])).sources.keys()]).toEqual(['a.jpg']);
  });
});

describe('sourceListing', () => {
  it('reads text from the dropped files and refuses oversized ones', async () => {
    const small = { path: 'a.json', size: 2, lastModified: null, blob: async () => new Blob(['{}']) };
    const big = { path: 'b.json', size: MAX_TEXT_BYTES + 1, lastModified: null, blob: async () => new Blob(['x']) };
    const listing = sourceListing(new Map([['a.json', small], ['b.json', big]]));
    expect(listing.entries.map((e) => e.path)).toEqual(['a.json', 'b.json']);
    expect(await listing.readText('a.json')).toBe('{}');
    await expect(listing.readText('b.json')).rejects.toThrow();
    await expect(listing.readText('c.json')).rejects.toThrow();
  });
});
