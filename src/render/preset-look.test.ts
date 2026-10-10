import { describe, expect, it } from 'vitest';
import { kindTabs, presetLook } from './preset-look';

describe('presetLook (grid columns and tile ratio per preset)', () => {
  it.each([
    ['generic', { tile: 'square', tileAspect: '1 / 1', columns: 3, desktopColumns: 4, minTileWidth: null, durationBadge: false }],
    ['instagram', { tile: 'square', tileAspect: '1 / 1', columns: 3, desktopColumns: 3, minTileWidth: null, durationBadge: false }],
    ['tiktok', { tile: 'vertical', tileAspect: '9 / 16', columns: 3, desktopColumns: 4, minTileWidth: null, durationBadge: false }],
    ['youtube', { tile: 'wide', tileAspect: '16 / 9', columns: 1, desktopColumns: null, minTileWidth: '18rem', durationBadge: true }],
    ['soundcloud', { tile: 'row', tileAspect: '1 / 1', columns: 1, desktopColumns: 1, minTileWidth: null, durationBadge: true }],
    ['facebook', { tile: 'square', tileAspect: '1 / 1', columns: 3, desktopColumns: 4, minTileWidth: null, durationBadge: false }],
  ] as const)('%s', (preset, look) => {
    expect(presetLook(preset)).toEqual(look);
  });
});

describe('kindTabs', () => {
  it('shows a tab per configured kind that has posts, never stories', () => {
    expect(kindTabs(['post', 'reel', 'story', 'igtv'], { post: 10, reel: 2, story: 40, igtv: 0 })).toEqual([
      { kind: 'post', label: 'Posts', count: 10 },
      { kind: 'reel', label: 'Reels', count: 2 },
    ]);
  });

  it('shows no tabs when only one kind has posts', () => {
    expect(kindTabs(['video', 'short'], { video: 5 })).toEqual([]);
  });
});
