import type { MediaItem, Post, Variant } from '../schema/post';

export const VERTICAL_ASPECT = 9 / 16;
/** `sizes` for a post's image: full width on phones, at most 935 px (the post column) on larger screens. */
export const IMAGE_SIZES = '(max-width: 935px) 100vw, 935px';

export type Layout =
  | { kind: 'carousel'; aspect: number }
  | { kind: 'vertical-video'; aspect: number }
  | { kind: 'video'; aspect: number }
  | { kind: 'image'; aspect: number }
  | { kind: 'audio' }
  | { kind: 'story' }
  | { kind: 'text' };

/** Width / height; audio has no frame, so it counts as square. */
export function aspectOf(item: MediaItem): number {
  return item.type === 'audio' ? 1 : item.width / item.height;
}

/** The spec's rendering table. The order matters: stories first, then the item count, then the first item's type. */
export function chooseLayout(post: Pick<Post, 'kind' | 'media'>): Layout {
  if (post.kind === 'story') return { kind: 'story' };
  const first = post.media[0];
  if (!first) return { kind: 'text' };
  if (post.media.length > 1) return { kind: 'carousel', aspect: aspectOf(first) };
  if (first.type === 'video') {
    return first.orientation === 'portrait' ? { kind: 'vertical-video', aspect: VERTICAL_ASPECT } : { kind: 'video', aspect: aspectOf(first) };
  }
  if (first.type === 'image') return { kind: 'image', aspect: aspectOf(first) };
  return { kind: 'audio' };
}

export function srcset(variants: Variant[]): string {
  return [...variants]
    .sort((a, b) => a.w - b.w)
    .map((v) => `${v.src} ${v.w}w`)
    .join(', ');
}
