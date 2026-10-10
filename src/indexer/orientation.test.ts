import { describe, expect, it } from 'vitest';
import { orientationOf } from './orientation';

describe('orientationOf', () => {
  it.each([
    [1080, 1350, 'square'],
    [1080, 1920, 'portrait'],
    [799, 1000, 'portrait'],
    [800, 1000, 'square'],
    [1250, 1000, 'square'],
    [1251, 1000, 'landscape'],
    [1920, 1080, 'landscape'],
  ] as const)('%i×%i → %s', (w, h, expected) => {
    expect(orientationOf(w, h)).toBe(expected);
  });
});
