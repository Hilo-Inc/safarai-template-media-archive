import { describe, expect, it } from 'vitest';
import type { AdminSummary } from '../schema/index-types';
import { cleanLinks, SavedValue, filterPosts, importActions, importLabel, selectionSummary, type ImportView } from './admin-view';

const status = (extra: Partial<ImportView> = {}): ImportView => ({
  id: 'lx0abc12-0a1b2c',
  importer: 'generic',
  source: 'upload',
  state: 'done',
  createdAt: '2025-01-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  files: 10,
  bytes: 2_000_000,
  posts: { total: 8, done: 8, failed: 0, skipped: 0 },
  failures: [],
  error: null,
  ...extra,
});

describe('importActions', () => {
  it.each([
    [{ state: 'uploading' }, ['resume', 'cancel']],
    [{ state: 'queued' }, []],
    [{ state: 'running' }, []],
    [{ state: 'done' }, ['remove']],
    [{ state: 'done', posts: { total: 8, done: 6, failed: 2, skipped: 0 } }, ['retry', 'remove']],
    [{ state: 'failed', error: 'boom' }, ['retry', 'remove']],
  ] as [Partial<ImportView>, string[]][])('%j → %j', (extra, expected) => {
    expect(importActions(status(extra))).toEqual(expected);
  });

  it('never offers resume for an inbox import', () => {
    expect(importActions(status({ state: 'uploading', source: 'inbox' }))).toEqual(['cancel']);
  });
});

describe('importLabel', () => {
  it('describes each state', () => {
    expect(importLabel(status({ state: 'uploading' }))).toBe('Waiting for files: 10 files, 2 MB');
    expect(importLabel(status({ state: 'queued' }))).toBe('Waiting to start');
    expect(importLabel(status({ state: 'running', posts: { total: 40, done: 12, failed: 1, skipped: 0 } }))).toBe('Processing: 13 of 40 posts');
    expect(importLabel(status({ state: 'running', posts: { total: 0, done: 0, failed: 0, skipped: 0 } }))).toBe('Reading the files');
    expect(importLabel(status())).toBe('Done: 8 posts');
    expect(importLabel(status({ posts: { total: 10, done: 7, failed: 2, skipped: 1 } }))).toBe('Done: 7 posts, 2 failed, 1 already imported');
    expect(importLabel(status({ state: 'failed', error: 'The bucket refused the request' }))).toBe('Failed: The bucket refused the request');
  });
});

describe('selectionSummary', () => {
  const e = (path: string, size: number) => ({ path, size, lastModified: null });

  it('counts what goes up and what stays', () => {
    expect(selectionSummary([e('a.jpg', 1_500_000_000), e('b.mp4', 1_000_000_000)], 12)).toBe(
      '2 files, 2.5 GB to upload. 10 other files stay on your computer.',
    );
    expect(selectionSummary([e('a.jpg', 1000)], 1)).toBe('1 file, 1 KB to upload.');
  });
});

describe('filterPosts', () => {
  const p = (id: string, extra: Partial<AdminSummary> = {}): AdminSummary => ({
    id,
    kind: 'post',
    platform: 'files',
    published: '2025-01-01T00:00:00.000Z',
    caption: '',
    cover: null,
    count: 1,
    duration: null,
    featured: false,
    hidden: false,
    ...extra,
  });
  const posts = [p('files_a', { caption: 'Beach Day' }), p('files_b', { hidden: true }), p('files_c', { featured: true })];

  it('filters by state and by caption or id text, ignoring case', () => {
    expect(filterPosts(posts, { text: '', show: 'all' }).map((x) => x.id)).toEqual(['files_a', 'files_b', 'files_c']);
    expect(filterPosts(posts, { text: '', show: 'hidden' }).map((x) => x.id)).toEqual(['files_b']);
    expect(filterPosts(posts, { text: '', show: 'visible' }).map((x) => x.id)).toEqual(['files_a', 'files_c']);
    expect(filterPosts(posts, { text: '', show: 'featured' }).map((x) => x.id)).toEqual(['files_c']);
    expect(filterPosts(posts, { text: 'beach', show: 'all' }).map((x) => x.id)).toEqual(['files_a']);
    expect(filterPosts(posts, { text: 'FILES_B', show: 'all' }).map((x) => x.id)).toEqual(['files_b']);
  });
});

describe('cleanLinks', () => {
  it('drops empty rows and keeps http(s) links', () => {
    expect(cleanLinks([{ label: ' Web ', url: ' https://a.example ' }, { label: '', url: '' }])).toEqual({ ok: true, links: [{ label: 'Web', url: 'https://a.example' }] });
  });

  it('refuses other schemes and half-filled rows', () => {
    expect(cleanLinks([{ label: 'x', url: 'javascript:alert(1)' }])).toEqual({ ok: false, error: 'Links must start with http:// or https://: x' });
    expect(cleanLinks([{ label: 'x', url: '' }])).toEqual({ ok: false, error: 'Each link needs a label and an address: x' });
    expect(cleanLinks([{ label: '', url: 'https://a.example' }])).toEqual({ ok: false, error: 'Each link needs a label and an address: https://a.example' });
  });
});

describe('SavedValue', () => {
  it('does nothing when the value did not change', () => {
    expect(new SavedValue('a').begin('a')).toBeNull();
  });

  it('a failed save restores the previous value and the next blur retries', () => {
    const saved = new SavedValue('old');
    const attempt = saved.begin('new')!;
    expect(attempt.next).toBe('new');
    expect(attempt.revert()).toBe('old');
    // The input shows "old" again; typing "new" again is a change again.
    expect(saved.begin('new')).not.toBeNull();
  });

  it('keeps the new value after a successful save', () => {
    const saved = new SavedValue('old');
    saved.begin('new');
    expect(saved.begin('new')).toBeNull();
  });

  it('a late revert does not undo a newer save', () => {
    const saved = new SavedValue('a');
    const first = saved.begin('b')!;
    saved.begin('c');
    expect(first.revert()).toBe('c');
  });
});

describe('SavedValue overlapping failures', () => {
  it('two failed saves return the last confirmed value, never one that was not saved', () => {
    const saved = new SavedValue('a');
    const b = saved.begin('b')!;
    const c = saved.begin('c')!;
    expect(b.revert()).toBe('c'); // a newer attempt is in flight
    expect(c.revert()).toBe('a');
  });

  it('reverts to the last value the server confirmed', () => {
    const saved = new SavedValue('a');
    const b = saved.begin('b')!;
    b.confirm();
    const c = saved.begin('c')!;
    expect(c.revert()).toBe('b');
  });
});
