import { shared } from './shared';
import { store } from './store';

/** A short-lived cache of bucket JSON for page rendering; cleared after every index build. */
export class JsonCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at <= this.ttlMs) return hit.value as Promise<T | null>;
    const value = load();
    this.entries.set(key, { at: this.now(), value });
    value.catch(() => this.entries.delete(key));
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

export function jsonCache(): JsonCache {
  return shared('json-cache', () => new JsonCache(30_000));
}

export function readJson<T>(key: string): Promise<T | null> {
  return jsonCache().get(key, () => store().getJson<T>(key));
}
