import type { Kind, Preset } from '../config/schema';

export interface Look {
  /** How a grid tile is shaped: square, 9:16, 16:9, or a list row. */
  tile: 'square' | 'vertical' | 'wide' | 'row';
  /** CSS `aspect-ratio` of a tile's media. */
  tileAspect: string;
  /** Columns on phones. */
  columns: number;
  /** Columns from 900 px up; null means "as many as fit `minTileWidth`". */
  desktopColumns: number | null;
  minTileWidth: string | null;
  durationBadge: boolean;
}

const SQUARE: Look = { tile: 'square', tileAspect: '1 / 1', columns: 3, desktopColumns: 4, minTileWidth: null, durationBadge: false };

// The Instagram preset's full look (4:5 tiles, profile header, stories) arrives with Plan 3; until then it is the
// neutral square grid at Instagram's three columns.
const LOOKS: Record<Preset, Look> = {
  generic: SQUARE,
  facebook: SQUARE,
  instagram: { ...SQUARE, desktopColumns: 3 },
  tiktok: { ...SQUARE, tile: 'vertical', tileAspect: '9 / 16' },
  youtube: { tile: 'wide', tileAspect: '16 / 9', columns: 1, desktopColumns: null, minTileWidth: '18rem', durationBadge: true },
  soundcloud: { tile: 'row', tileAspect: '1 / 1', columns: 1, desktopColumns: 1, minTileWidth: null, durationBadge: true },
};

export function presetLook(preset: Preset): Look {
  return LOOKS[preset];
}

export const KIND_LABELS: Record<Kind, string> = {
  post: 'Posts',
  reel: 'Reels',
  story: 'Stories',
  igtv: 'IGTV',
  video: 'Videos',
  short: 'Shorts',
  track: 'Tracks',
};

/** Tabs for `/kind/<kind>` pages: configured kinds with posts, in config order, never stories (they have their own viewer). */
export function kindTabs(kinds: readonly Kind[], counts: Record<string, number>): { kind: Kind; label: string; count: number }[] {
  const tabs = kinds
    .filter((k) => k !== 'story' && (counts[k] ?? 0) > 0)
    .map((kind) => ({ kind, label: KIND_LABELS[kind], count: counts[kind]! }));
  return tabs.length > 1 ? tabs : [];
}
