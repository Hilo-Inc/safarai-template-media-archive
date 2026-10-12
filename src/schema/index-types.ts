import type { Kind, Visibility } from '../config/schema';
import type { Post, Variant } from './post';

export const PAGE_SIZE = 48;
export const CAPTION_SUMMARY_LENGTH = 140;

export interface Cover {
  type: 'image' | 'video';
  src: string;
  width: number;
  height: number;
  thumbhash: string | null;
  variants: Variant[];
}

export interface PostSummary {
  id: string;
  kind: Kind;
  platform: string;
  published: string;
  caption: string;
  cover: Cover | null;
  /** Number of media items. */
  count: number;
  /** Seconds, for a post whose first item is video or audio. */
  duration: number | null;
  featured: boolean;
}

export interface IndexPage {
  page: number;
  pages: number;
  posts: PostSummary[];
}

export interface StoryMonth {
  month: string;
  posts: (PostSummary & { day: number })[];
}

export interface IndexMeta {
  schema: 1;
  built: string;
  visibility: Visibility;
  counts: { all: number; platforms: Record<string, number>; kinds: Record<string, number> };
  /** Platforms with at least one visible post, most posts first. */
  platforms: string[];
  /** Page count per index scope: "all", "<platform>", "kind/<kind>", "tag/<tag>". */
  pages: Record<string, number>;
  storyMonths: string[];
  /** Visible stories per month ("YYYY-MM"), for the stories pages' month list. */
  storyCounts?: Record<string, number>;
  /** Tags of visible posts, most used first. */
  tags: string[];
}

export type AdminSummary = PostSummary & { hidden: boolean };

export interface AdminIndex {
  built: string;
  posts: AdminSummary[];
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export function summarize(post: Post): PostSummary {
  const first = post.media[0]!;
  let cover: Cover | null = null;
  if (first.type === 'image') {
    cover = { type: 'image', src: first.src, width: first.width, height: first.height, thumbhash: first.thumbhash, variants: first.variants };
  } else if (first.type === 'video' && first.poster) {
    const p = first.poster;
    cover = { type: 'video', src: p.src, width: p.width, height: p.height, thumbhash: p.thumbhash, variants: p.variants };
  }
  return {
    id: post.id,
    kind: post.kind,
    platform: post.platform,
    published: post.published,
    caption: truncate(post.caption, CAPTION_SUMMARY_LENGTH),
    cover,
    count: post.media.length,
    duration: first.type === 'image' ? null : first.duration,
    featured: post.featured,
  };
}
