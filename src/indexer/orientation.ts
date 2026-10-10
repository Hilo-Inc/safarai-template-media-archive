import type { Orientation } from '../schema/post';

/** From the displayed size: < 0.8 portrait, 0.8–1.25 square, > 1.25 landscape. */
export function orientationOf(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio < 0.8) return 'portrait';
  if (ratio > 1.25) return 'landscape';
  return 'square';
}
