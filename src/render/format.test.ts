import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatDate, formatDuration, postCount } from './format';

describe('format', () => {
  it('writes durations as m:ss or h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('writes dates in UTC, day month year', () => {
    expect(formatDate('2025-02-10T23:30:00.000Z')).toBe('10 Feb 2025');
  });

  it('writes nothing for a date that does not parse, instead of throwing', () => {
    expect(formatDate('not a date')).toBe('');
    expect(formatDate('')).toBe('');
  });

  it('groups thousands', () => {
    expect(formatCount(4880)).toBe('4,880');
  });

  it('writes sizes in decimal units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(5_500_000_000)).toBe('5.5 GB');
    expect(formatBytes(1_250_000)).toBe('1.3 MB');
  });
});

describe('postCount', () => {
  it('uses the singular for one and groups thousands', () => {
    expect(postCount(0)).toBe('0 posts');
    expect(postCount(1)).toBe('1 post');
    expect(postCount(36)).toBe('36 posts');
    expect(postCount(1204)).toBe('1,204 posts');
  });
});
