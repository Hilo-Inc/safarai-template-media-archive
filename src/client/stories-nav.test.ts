import { describe, expect, it } from 'vitest';
import { classifyGesture, closeAction, dayRange, HOLD_MS, isStale, next, preloadIds, prev, safeUrl, STALE_MS, storyUrl, SWIPE_CLOSE_PX, tapZone } from './stories-nav';

const refs = [{ id: 'a', day: 15 }, { id: 'b', day: 31 }, { id: 'c', day: 31 }];
const months = ['2024-01', '2024-02'];

describe('stories navigation', () => {
  it('finds the current day’s stories for the progress bars', () => {
    expect(dayRange(refs, 2)).toEqual({ start: 1, end: 3 });
    expect(dayRange(refs, 0)).toEqual({ start: 0, end: 1 });
  });
  it('moves forward within a month, then into the next month, then closes', () => {
    expect(next(months, { month: '2024-01', index: 0 }, 3)).toEqual({ kind: 'move', index: 1 });
    expect(next(months, { month: '2024-01', index: 2 }, 3)).toEqual({ kind: 'month', month: '2024-02', at: 'first' });
    expect(next(months, { month: '2024-02', index: 0 }, 1)).toEqual({ kind: 'close' });
  });
  it('moves back into the previous month and does nothing on the oldest story', () => {
    expect(prev(months, { month: '2024-01', index: 1 })).toEqual({ kind: 'move', index: 0 });
    expect(prev(months, { month: '2024-02', index: 0 })).toEqual({ kind: 'month', month: '2024-01', at: 'last' });
    expect(prev(months, { month: '2024-01', index: 0 })).toBeNull();
  });
  it('preloads the current story and the next two in the month', () => {
    expect(preloadIds(refs, 0)).toEqual(['a', 'b', 'c']);
    expect(preloadIds(refs, 2)).toEqual(['c']);
  });
  it('maps taps to thirds', () => {
    expect(tapZone(10, 300)).toBe('prev');
    expect(tapZone(150, 300)).toBe('next');
    expect(tapZone(290, 300)).toBe('next');
  });
  it('refetches post JSON after 50 minutes', () => {
    expect(isStale(0, STALE_MS)).toBe(false);
    expect(isStale(0, STALE_MS + 1)).toBe(true);
  });
  it('builds the story URL', () => {
    expect(storyUrl('2024-01', 'instagram_a')).toBe('/stories/2024-01?s=instagram_a');
  });
});

describe('stories close and gestures', () => {
  it('closes through history when the viewer owns the entry', () => {
    expect(closeAction('2024-01', '2024-01', true, false)).toEqual({ kind: 'back' });
    expect(closeAction('2024-01', '2024-03', true, false)).toEqual({ kind: 'back' });
  });
  it('after history has gone back, stays or replaces to the viewer’s month', () => {
    expect(closeAction('2024-01', '2024-01', true, true)).toEqual({ kind: 'stay' });
    expect(closeAction('2024-01', '2024-03', true, true)).toEqual({ kind: 'navigate', url: '/stories/2024-03' });
  });
  it('without an owned entry (deep link), resets the URL or replaces to the month', () => {
    expect(closeAction('2024-01', '2024-01', false, false)).toEqual({ kind: 'reset', url: '/stories/2024-01' });
    expect(closeAction('2024-01', '2024-02', false, false)).toEqual({ kind: 'navigate', url: '/stories/2024-02' });
  });
  it('classifies gestures', () => {
    expect(classifyGesture(2, 3, 100)).toBe('tap');
    expect(classifyGesture(0, 0, HOLD_MS)).toBe('hold');
    expect(classifyGesture(5, SWIPE_CLOSE_PX, 3000)).toBe('swipe-close');
    expect(classifyGesture(0, -SWIPE_CLOSE_PX, 50)).toBe('none');
    expect(classifyGesture(40, 20, 100)).toBe('none');
  });
  it('accepts only http(s) media URLs', () => {
    const base = 'https://example.com/stories/2024-01';
    expect(safeUrl('https://cdn.example.com/a.jpg', base)).toBe('https://cdn.example.com/a.jpg');
    expect(safeUrl('/media/a.jpg', base)).toBe('https://example.com/media/a.jpg');
    expect(safeUrl('javascript:alert(1)', base)).toBeNull();
    expect(safeUrl('data:text/html,x', base)).toBeNull();
    expect(safeUrl('http://[bad', base)).toBeNull();
  });
});
