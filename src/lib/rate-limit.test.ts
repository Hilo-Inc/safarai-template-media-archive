import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('blocks after the limit within the window and frees after it', () => {
    let now = 0;
    const rl = new RateLimiter(3, 1000, () => now);
    for (let i = 0; i < 3; i++) {
      expect(rl.blocked('ip')).toBe(false);
      rl.fail('ip');
    }
    expect(rl.blocked('ip')).toBe(true);
    expect(rl.blocked('other')).toBe(false);
    now = 1001;
    expect(rl.blocked('ip')).toBe(false);
  });

  it('resets on success', () => {
    const rl = new RateLimiter(1, 1000, () => 0);
    rl.fail('ip');
    rl.reset('ip');
    expect(rl.blocked('ip')).toBe(false);
  });
});
