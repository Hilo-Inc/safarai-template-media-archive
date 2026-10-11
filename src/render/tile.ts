import type { PostSummary } from '../schema/index-types';
import { formatDate, formatDuration } from './format';

export type TileIcon = 'pin' | 'carousel' | 'play' | 'audio';

/** The one corner icon a tile shows: pinned beats carousel beats playable media. */
export function tileIcon(post: PostSummary): TileIcon | null {
  if (post.featured) return 'pin';
  if (post.count > 1) return 'carousel';
  if (post.duration === null) return null;
  return post.kind === 'track' ? 'audio' : 'play';
}

/** The line shown over a tile on hover or keyboard focus. */
export function tileHover(post: PostSummary): string {
  const extra = post.count > 1 ? `${post.count} items` : post.duration !== null ? formatDuration(post.duration) : null;
  return [formatDate(post.published), extra].filter(Boolean).join(' · ');
}
