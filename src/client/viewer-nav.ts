// The viewer's rules, free of DOM access so they can be unit-tested. src/client/viewer.ts wires them to the page.

export interface NavState {
  /** Post ids of the grid's tiles, in page order. */
  ids: string[];
  /** Index of the shown post in `ids`, or -1. */
  index: number;
  /** Whether the grid has a "More" link (another page to load). */
  hasMorePages: boolean;
}

/** Which way a step goes, or null when it can't (start of list, end with no more pages, or no shown post). */
export function step(state: NavState, dir: -1 | 1): { kind: 'move'; index: number } | { kind: 'load-more' } | null {
  if (state.index < 0) return null;
  const next = state.index + dir;
  if (next < 0) return null;
  if (next < state.ids.length) return { kind: 'move', index: next };
  return state.hasMorePages ? { kind: 'load-more' } : null;
}

/** Ids to prefetch around the shown post: one before and one after, when they exist. */
export function neighbours(state: NavState): string[] {
  if (state.index < 0) return [];
  return [state.ids[state.index - 1], state.ids[state.index + 1]].filter((id): id is string => id !== undefined);
}

export const SWIPE_MIN_PX = 60;
export const SWIPE_MAX_MS = 600;

/** Is this pointer gesture a post-to-post swipe? A finger moving left (dx < 0) means the next post. */
export function isSwipe(dx: number, dy: number, ms: number): -1 | 1 | null {
  if (ms > SWIPE_MAX_MS || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  return dx < 0 ? 1 : -1;
}

/** A plain left click opens the viewer; modified and middle clicks keep the browser's behaviour (new tab, window…). */
export function shouldIntercept(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/** A fragment is shown only from a direct ok response; a redirect means the session ended (password mode). */
export function fragmentOutcome(res: { ok: boolean; redirected: boolean }): 'show' | 'navigate' {
  return res.ok && !res.redirected ? 'show' : 'navigate';
}

/** The post id of a same-origin `/p/<id>` link, or null. */
export function idFromHref(href: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== new URL(base).origin) return null;
  const match = /^\/p\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/** A small least-recently-used cache (a Map keeps insertion order; re-inserting on read marks an entry as recent). */
export class FragmentCache<V> {
  readonly #entries = new Map<string, V>();
  constructor(readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.limit) this.#entries.delete(this.#entries.keys().next().value!);
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** For overlapping async work where only the newest request may finish: `const isCurrent = begin(); …; if (!isCurrent()) return;`. */
export function latest(): () => () => boolean {
  let counter = 0;
  return () => {
    const mine = ++counter;
    return () => mine === counter;
  };
}
