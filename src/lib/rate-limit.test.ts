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

describe('RateLimiter bounds', () => {
  it('trips a global cap regardless of key', () => {
    const rl = new RateLimiter(10, 1000, () => 0, 3);
    rl.fail('a');
    rl.fail('b');
    expect(rl.blocked('c')).toBe(false);
    rl.fail('c');
    expect(rl.blocked('d')).toBe(true);
  });
  it('clears the global cap after the window', () => {
    let now = 0;
    const rl = new RateLimiter(10, 1000, () => now, 2);
    rl.fail('a');
    rl.fail('b');
    expect(rl.blocked('z')).toBe(true);
    now = 1001;
    expect(rl.blocked('z')).toBe(false);
  });
  it('prunes expired keys so the map stays bounded', () => {
    let now = 0;
    const rl = new RateLimiter(10, 1000, () => now, 1_000_000, 5);
    for (let i = 0; i < 5; i++) rl.fail(`k${i}`);
    now = 2000;
    rl.fail('fresh');
    expect(rl.size()).toBe(1);
  });
});
