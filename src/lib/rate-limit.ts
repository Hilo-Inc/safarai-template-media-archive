import { shared } from './shared';

/**
 * Fixed-window failure counter per key (in memory; one container), plus a global failure cap
 * that ignores the key, so rotating spoofed keys cannot bypass the limit. The key map is bounded.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private global = { start: 0, count: 0 };

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly globalLimit: number = 100,
    private readonly maxKeys: number = 10_000,
  ) {}

  private current(key: string) {
    const w = this.windows.get(key);
    if (w && this.now() - w.start > this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return w;
  }

  private currentGlobal() {
    if (this.global.count > 0 && this.now() - this.global.start > this.windowMs) this.global = { start: 0, count: 0 };
    return this.global;
  }

  private prune() {
    const now = this.now();
    for (const [key, w] of this.windows) if (now - w.start > this.windowMs) this.windows.delete(key);
    // Still over the cap with only live entries: drop the oldest (Map keeps insertion order).
    for (const key of this.windows.keys()) {
      if (this.windows.size <= this.maxKeys) break;
      this.windows.delete(key);
    }
  }

  size(): number {
    return this.windows.size;
  }

  blocked(key: string): boolean {
    if (this.currentGlobal().count >= this.globalLimit) return true;
    return (this.current(key)?.count ?? 0) >= this.limit;
  }

  fail(key: string): void {
    const g = this.currentGlobal();
    if (g.count === 0) g.start = this.now();
    g.count++;
    const w = this.current(key);
    if (w) w.count++;
    else {
      this.windows.set(key, { start: this.now(), count: 1 });
      if (this.windows.size > this.maxKeys) this.prune();
    }
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}

export function loginLimiter(): RateLimiter {
  return shared('login-limiter', () => new RateLimiter(10, 15 * 60 * 1000));
}
