import { describe, expect, it } from 'vitest';
import { reducePeaks, variantWidths } from './derive';

describe('variantWidths', () => {
  it('never upscales and adds the own width under 2048', () => {
    expect(variantWidths(4000)).toEqual([320, 640, 1280, 2048]);
    expect(variantWidths(2048)).toEqual([320, 640, 1280, 2048]);
    expect(variantWidths(1080)).toEqual([320, 640, 1080]);
    expect(variantWidths(1280)).toEqual([320, 640, 1280]);
    expect(variantWidths(200)).toEqual([200]);
  });
});

describe('reducePeaks', () => {
  it('keeps the maximum of each bucket, normalised to 1, 3 decimals', () => {
    expect(reducePeaks([0.1, 0.5, 0.2, 0.25, 0, 0.05], 3)).toEqual([1, 0.5, 0.1]);
  });

  it('returns exactly count values when there are more', () => {
    const values = Array.from({ length: 4567 }, (_, i) => (i % 10) / 10);
    expect(reducePeaks(values, 1000)).toHaveLength(1000);
  });

  it('keeps short input as it is (normalised) and handles silence', () => {
    expect(reducePeaks([0.2, 0.4], 1000)).toEqual([0.5, 1]);
    expect(reducePeaks([0, 0, 0], 2)).toEqual([0, 0]);
    expect(reducePeaks([], 1000)).toEqual([]);
  });
});
