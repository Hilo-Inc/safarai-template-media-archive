import type { LocationMode } from '../config/schema';
import type { RawPost } from '../importers/types';
import type { Post } from '../schema/post';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Applies the `location` setting. Only lat, lng and name ever pass through. */
export function applyLocation(location: RawPost['location'] | undefined, mode: LocationMode): Post['location'] {
  if (!location || mode === 'none') return null;
  const name = 'name' in location && location.name ? location.name : null;
  const coords = 'lat' in location ? { lat: location.lat, lng: location.lng } : null;
  if (mode === 'place' || !coords) return name ? { name } : null;
  const point = mode === 'rounded' ? { lat: round2(coords.lat), lng: round2(coords.lng) } : coords;
  return name ? { ...point, name } : point;
}
