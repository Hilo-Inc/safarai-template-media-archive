import { Feed } from 'feed';
import { encodeKey } from '../lib/keys';
import { summarize, type Cover } from '../schema/index-types';
import type { Post } from '../schema/post';
import type { Site } from '../schema/site';

export const FEED_SIZE = 50;
const TITLE_LENGTH = 80;

function titleOf(post: Post): string {
  const line = post.caption.split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return `Post from ${post.published.slice(0, 10)}`;
  const chars = Array.from(line);
  return chars.length <= TITLE_LENGTH ? line : `${chars.slice(0, TITLE_LENGTH - 1).join('')}…`;
}

/** The largest variant up to 1280 px wide, else the smallest, else the cover itself. */
function coverKey(cover: Cover): string {
  return cover.variants.filter((v) => v.w <= 1280).at(-1)?.src ?? cover.variants[0]?.src ?? cover.src;
}

export function buildFeeds(
  posts: Post[],
  site: Site,
  opts: { siteUrl: string; mediaPublicUrl: string | null; now: Date },
): { json: string; rss: string } {
  const base = opts.siteUrl.replace(/\/+$/, '');
  const mediaBase = opts.mediaPublicUrl?.replace(/\/+$/, '') ?? null;
  const feed = new Feed({
    title: site.title,
    description: site.bio || undefined,
    id: `${base}/`,
    link: `${base}/`,
    copyright: '',
    updated: opts.now,
    generator: 'Media Archive',
    feedLinks: { json: `${base}/feed.json`, rss: `${base}/rss.xml` },
  });
  const latest = [...posts].sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, FEED_SIZE);
  for (const post of latest) {
    const url = `${base}/p/${encodeURIComponent(post.id)}`;
    const cover = summarize(post).cover;
    feed.addItem({
      title: titleOf(post),
      id: url,
      link: url,
      date: new Date(post.published),
      description: post.caption || undefined,
      image: cover && mediaBase ? `${mediaBase}/${encodeKey(coverKey(cover))}` : undefined,
    });
  }
  return { json: feed.json1(), rss: feed.rss2() };
}
