import { shared } from './shared';

/** Fixed-window failure counter per key (in memory; one container). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private current(key: string) {
    const w = this.windows.get(key);
    if (w && this.now() - w.start > this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return w;
  }

  blocked(key: string): boolean {
    return (this.current(key)?.count ?? 0) >= this.limit;
  }

  fail(key: string): void {
    const w = this.current(key);
    if (w) w.count++;
    else this.windows.set(key, { start: this.now(), count: 1 });
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}

export function loginLimiter(): RateLimiter {
  return shared('login-limiter', () => new RateLimiter(10, 15 * 60 * 1000));
}
