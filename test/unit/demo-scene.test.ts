import { describe, expect, it } from 'vitest';
import { random, sceneSvg } from '../../scripts/demo/scene';

describe('random', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = random(42);
    const b = random(42);
    const values = Array.from({ length: 100 }, () => a());
    expect(values).toEqual(Array.from({ length: 100 }, () => b()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(random(43)()).not.toBe(random(42)());
  });
});

describe('sceneSvg', () => {
  it('draws an SVG of the asked size, the same for the same seed', () => {
    const spec = { mood: 'dusk', scene: 'sea', seed: 7, width: 1200, height: 1500 } as const;
    const svg = sceneSvg(spec);
    expect(svg).toMatch(/^<svg [^>]*width="1200" height="1500" viewBox="0 0 1200 1500"/);
    expect(svg).toBe(sceneSvg(spec));
    expect(sceneSvg({ ...spec, seed: 8 })).not.toBe(svg);
  });

  it('adds stars only at night', () => {
    const count = (svg: string) => (svg.match(/fill="#fff"/g) ?? []).length;
    expect(count(sceneSvg({ mood: 'night', scene: 'hills', seed: 1, width: 400, height: 400 }))).toBeGreaterThan(10);
    expect(count(sceneSvg({ mood: 'noon', scene: 'hills', seed: 1, width: 400, height: 400 }))).toBe(0);
  });
});
