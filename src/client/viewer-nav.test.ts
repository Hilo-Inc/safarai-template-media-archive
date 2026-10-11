import { describe, expect, it } from 'vitest';
import { FragmentCache, fragmentOutcome, idFromHref, isSwipe, latest, neighbours, shouldIntercept, step } from './viewer-nav';

const ids = ['a', 'b', 'c'];

describe('step', () => {
  it('moves within the loaded posts', () => {
    expect(step({ ids, index: 1, hasMorePages: false }, 1)).toEqual({ kind: 'move', index: 2 });
    expect(step({ ids, index: 1, hasMorePages: false }, -1)).toEqual({ kind: 'move', index: 0 });
  });
  it('cannot go before the first post', () => {
    expect(step({ ids, index: 0, hasMorePages: true }, -1)).toBeNull();
  });
  it('loads more at the end when there are more pages, and stops otherwise', () => {
    expect(step({ ids, index: 2, hasMorePages: true }, 1)).toEqual({ kind: 'load-more' });
    expect(step({ ids, index: 2, hasMorePages: false }, 1)).toBeNull();
  });
  it('does nothing when the shown post is not in the grid', () => {
    expect(step({ ids, index: -1, hasMorePages: true }, 1)).toBeNull();
    expect(step({ ids, index: -1, hasMorePages: true }, -1)).toBeNull();
  });
});

describe('neighbours', () => {
  it('gives the posts either side, when they exist', () => {
    expect(neighbours({ ids, index: 1, hasMorePages: false })).toEqual(['a', 'c']);
    expect(neighbours({ ids, index: 0, hasMorePages: false })).toEqual(['b']);
    expect(neighbours({ ids, index: 2, hasMorePages: true })).toEqual(['b']);
    expect(neighbours({ ids: ['a'], index: 0, hasMorePages: false })).toEqual([]);
    expect(neighbours({ ids, index: -1, hasMorePages: false })).toEqual([]);
  });
});

describe('isSwipe', () => {
  it('a fast, long, mostly horizontal move steps: left is next, right is previous', () => {
    expect(isSwipe(-80, 10, 300)).toBe(1);
    expect(isSwipe(80, -10, 300)).toBe(-1);
  });
  it('ignores short, slow or diagonal moves', () => {
    expect(isSwipe(-59, 0, 300)).toBeNull();
    expect(isSwipe(-60, 0, 300)).toBe(1);
    expect(isSwipe(-200, 0, 601)).toBeNull();
    expect(isSwipe(-100, 60, 300)).toBeNull();
    expect(isSwipe(-100, 50, 300)).toBe(1);
  });
});

describe('shouldIntercept', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  it('takes a plain left click only', () => {
    expect(shouldIntercept(click)).toBe(true);
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) expect(shouldIntercept({ ...click, [key]: true })).toBe(false);
    expect(shouldIntercept({ ...click, button: 1 })).toBe(false);
    expect(shouldIntercept({ ...click, defaultPrevented: true })).toBe(false);
  });
});

describe('fragmentOutcome', () => {
  it('shows an ok, direct response; navigates on errors and redirects (ended session)', () => {
    expect(fragmentOutcome({ ok: true, redirected: false })).toBe('show');
    expect(fragmentOutcome({ ok: true, redirected: true })).toBe('navigate');
    expect(fragmentOutcome({ ok: false, redirected: false })).toBe('navigate');
  });
});

describe('idFromHref', () => {
  const base = 'https://site.example/kind/video';
  it('reads same-origin post links only', () => {
    expect(idFromHref('/p/demo_d01', base)).toBe('demo_d01');
    expect(idFromHref('https://site.example/p/files_a%20b', base)).toBe('files_a b');
    expect(idFromHref('https://other.example/p/demo_d01', base)).toBeNull();
    expect(idFromHref('/p/demo_d01/extra', base)).toBeNull();
    expect(idFromHref('/tags/sea', base)).toBeNull();
    expect(idFromHref('/p/%E0%A4%A', base)).toBeNull();
  });
});

describe('FragmentCache', () => {
  it('keeps the most recently used entries up to the limit', () => {
    const cache = new FragmentCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // a is now the most recent
    cache.set('c', 3); // evicts b
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });
});

describe('latest', () => {
  it('only the newest request stays current', () => {
    const begin = latest();
    const first = begin();
    expect(first()).toBe(true);
    const second = begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });
});
