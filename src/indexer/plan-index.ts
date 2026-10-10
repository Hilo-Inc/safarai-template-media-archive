import type { ArchiveConfig } from '../config/schema';
import { RESERVED_PLATFORMS } from '../importers/text';
import { keys } from '../lib/keys';
import { PAGE_SIZE, summarize, type AdminIndex, type IndexMeta, type IndexPage, type StoryMonth } from '../schema/index-types';
import type { Post } from '../schema/post';

/** Tags that get a page: letters, digits, `_` and `-` only, so a tag is always one key segment. */
export const TAG_RE = /^[\p{L}\p{N}_-]{1,100}$/u;

const time = (p: Post) => Date.parse(p.published);
const newestFirst = (a: Post, b: Post) => time(b) - time(a) || a.id.localeCompare(b.id);
const oldestFirst = (a: Post, b: Post) => time(a) - time(b) || a.id.localeCompare(b.id);
const featuredFirst = (list: Post[]) => [...list.filter((p) => p.featured), ...list.filter((p) => !p.featured)];

function tally(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function mostUsed(counts: Map<string, number>): string[] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

const tagsOf = (p: Post) => [...new Set(p.tags)].filter((t) => TAG_RE.test(t));

/** Every index file as bucket key → JSON. Pure: the caller writes it and deletes keys it no longer contains. */
export function planIndex(posts: Post[], config: ArchiveConfig, now: Date): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const sorted = [...posts].sort(newestFirst);
  const visible = sorted.filter((p) => !p.hidden && config.kinds.includes(p.kind));
  const grid = visible.filter((p) => p.kind !== 'story');
  const stories = visible.filter((p) => p.kind === 'story');
  const pages: Record<string, number> = {};

  const writeScope = (scope: string, list: Post[], always = false) => {
    if (list.length === 0 && !always) return;
    const summaries = list.map(summarize);
    const total = Math.max(1, Math.ceil(summaries.length / PAGE_SIZE));
    pages[scope] = total;
    for (let page = 1; page <= total; page++) {
      const body: IndexPage = { page, pages: total, posts: summaries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
      out.set(keys.indexPage(scope, page), body);
    }
  };

  writeScope('all', featuredFirst(grid), true);

  const platformCounts = tally(grid.map((p) => p.platform));
  const platforms = mostUsed(platformCounts).filter((p) => !RESERVED_PLATFORMS.has(p));
  for (const platform of platforms) writeScope(platform, featuredFirst(grid.filter((p) => p.platform === platform)));

  for (const kind of new Set(grid.map((p) => p.kind))) writeScope(`kind/${kind}`, featuredFirst(grid.filter((p) => p.kind === kind)));

  const tags = mostUsed(tally(grid.flatMap(tagsOf)));
  for (const tag of tags) writeScope(`tag/${tag}`, grid.filter((p) => tagsOf(p).includes(tag)));

  const months = new Map<string, Post[]>();
  for (const story of stories) {
    const month = new Date(story.published).toISOString().slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), story]);
  }
  const storyMonths = [...months.keys()].sort();
  for (const month of storyMonths) {
    const body: StoryMonth = {
      month,
      posts: months
        .get(month)!
        .sort(oldestFirst)
        .map((p) => ({ ...summarize(p), day: new Date(p.published).getUTCDate() })),
    };
    out.set(keys.storyMonth(month), body);
  }

  const meta: IndexMeta = {
    schema: 1,
    built: now.toISOString(),
    visibility: config.visibility,
    counts: {
      all: grid.length,
      platforms: Object.fromEntries(platformCounts),
      kinds: Object.fromEntries(tally(visible.map((p) => p.kind))),
    },
    platforms,
    pages,
    storyMonths,
    tags,
  };
  out.set(keys.indexMeta, meta);

  const admin: AdminIndex = { built: now.toISOString(), posts: sorted.map((p) => ({ ...summarize(p), hidden: p.hidden })) };
  out.set(keys.adminIndex, admin);
  return out;
}
