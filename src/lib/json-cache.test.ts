import { describe, expect, it } from 'vitest';
import { JsonCache } from './json-cache';

describe('JsonCache', () => {
  it('loads once within the lifetime, again after it or after clear()', async () => {
    let now = 0;
    let loads = 0;
    const cache = new JsonCache(30_000, () => now);
    const load = async () => ({ n: ++loads });
    expect(await cache.get('k', load)).toEqual({ n: 1 });
    expect(await cache.get('k', load)).toEqual({ n: 1 });
    now = 30_001;
    expect(await cache.get('k', load)).toEqual({ n: 2 });
    cache.clear();
    expect(await cache.get('k', load)).toEqual({ n: 3 });
  });

  it('does not cache a failed load', async () => {
    const cache = new JsonCache(30_000, () => 0);
    await expect(cache.get('k', async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(await cache.get('k', async () => 1)).toBe(1);
  });
});
