// The stories viewer's rules, free of DOM access so they can be unit-tested. src/client/stories.ts wires them to the page.

export const IMAGE_MS = 5000;
export const ERROR_MS = 5000;
export const HOLD_MS = 250;
/** Signed media URLs last an hour; post JSON older than this is fetched again before it plays (the grids' rule). */
export const STALE_MS = 50 * 60 * 1000;
export const PRELOAD = 2;
export const SWIPE_CLOSE_PX = 80;

export interface StoryRef {
  id: string;
  day: number;
}

export interface Place {
  month: string;
  index: number;
}

/** Indexes (in `stories`) of the stories on the same day as `index`. */
export function dayRange(stories: StoryRef[], index: number): { start: number; end: number } {
  const day = stories[index]!.day;
  let start = index;
  let end = index + 1;
  while (start > 0 && stories[start - 1]!.day === day) start--;
  while (end < stories.length && stories[end]!.day === day) end++;
  return { start, end };
}

/** After the current story: the next in the month, else the first of the next month, else close. */
export function next(months: string[], place: Place, length: number): { kind: 'move'; index: number } | { kind: 'month'; month: string; at: 'first' } | { kind: 'close' } {
  if (place.index + 1 < length) return { kind: 'move', index: place.index + 1 };
  const later = months[months.indexOf(place.month) + 1];
  return later ? { kind: 'month', month: later, at: 'first' } : { kind: 'close' };
}

/** Before the current story: the previous in the month, else the last of the previous month, else stay. */
export function prev(months: string[], place: Place): { kind: 'move'; index: number } | { kind: 'month'; month: string; at: 'last' } | null {
  if (place.index > 0) return { kind: 'move', index: place.index - 1 };
  const i = months.indexOf(place.month);
  return i > 0 ? { kind: 'month', month: months[i - 1]!, at: 'last' } : null;
}

/** The current story and the next PRELOAD ids, within the month. */
export function preloadIds(stories: StoryRef[], index: number): string[] {
  return stories.slice(index, index + 1 + PRELOAD).map((s) => s.id);
}

/** A tap's action from where it lands: the left third goes back, anything else forward. */
export function tapZone(x: number, width: number): 'prev' | 'next' {
  return x < width / 3 ? 'prev' : 'next';
}

export function isStale(fetchedAt: number, now: number): boolean {
  return now - fetchedAt > STALE_MS;
}

export function storyUrl(month: string, id: string): string {
  return `/stories/${month}?s=${encodeURIComponent(id)}`;
}
