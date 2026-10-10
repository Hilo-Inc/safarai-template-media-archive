import { describe, expect, it } from 'vitest';
import { shared } from './shared';

describe('shared', () => {
  it('creates once per name and returns the same value afterwards', () => {
    let calls = 0;
    const a = shared('test.shared', () => ({ n: ++calls }));
    const b = shared('test.shared', () => ({ n: ++calls }));
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});
