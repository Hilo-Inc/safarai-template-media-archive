import { describe, expect, it } from 'vitest';
import type { PostSummary } from '../schema/index-types';
import { tileHover, tileIcon } from './tile';

const post = (extra: Partial<PostSummary> = {}): PostSummary => ({
  id: 'files_a',
  kind: 'post',
  platform: 'files',
  published: '2025-02-10T12:00:00.000Z',
  caption: '',
  cover: null,
  count: 1,
  duration: null,
  featured: false,
  ...extra,
});

describe('tileIcon', () => {
  it('shows one icon: pin, then carousel, then play, then audio', () => {
    expect(tileIcon(post({ featured: true, count: 3, kind: 'video', duration: 5 }))).toBe('pin');
    expect(tileIcon(post({ count: 3 }))).toBe('carousel');
    expect(tileIcon(post({ kind: 'video', duration: 5 }))).toBe('play');
    expect(tileIcon(post({ kind: 'reel', duration: 5 }))).toBe('play');
    expect(tileIcon(post({ kind: 'track', duration: 20 }))).toBe('audio');
    expect(tileIcon(post())).toBeNull();
  });
});

describe('tileHover', () => {
  it('shows the date, plus the item count or the duration', () => {
    expect(tileHover(post())).toBe('10 Feb 2025');
    expect(tileHover(post({ count: 3 }))).toBe('10 Feb 2025 · 3 items');
    expect(tileHover(post({ kind: 'video', duration: 75 }))).toBe('10 Feb 2025 · 1:15');
  });
});
