import type { ArchiveConfig } from '../config/schema';
import { jsonCache } from '../lib/json-cache';
import { CACHE_JSON, keys } from '../lib/keys';
import { mapLimit } from '../lib/pool';
import { loadSite, PRIVATE_JSON } from '../lib/site';
import type { Store } from '../lib/store';
import { postJsonSchema, postSchema, type Post } from '../schema/post';
import { buildFeeds } from './feeds';
import { planIndex } from './plan-index';

export interface BuildOptions {
  siteUrl: string | null;
  mediaPublicUrl: string | null;
  now?: Date;
}

export interface BuildResult {
  posts: number;
  /** Keys of post JSON that did not parse. */
  skipped: string[];
  feeds: boolean;
}

/** Loads every post, then rewrites index/, the feeds and the schema, and deletes index files that no longer exist. */
export async function buildIndex(store: Store, config: ArchiveConfig, opts: BuildOptions): Promise<BuildResult> {
  const now = opts.now ?? new Date();
  const listed = (await store.list(keys.postsPrefix)).filter((o) => o.key.endsWith('.json'));
  const loaded = await mapLimit(listed, 16, async (o) => {
    try {
      return { key: o.key, parsed: postSchema.safeParse(await store.getJson(o.key)) };
    } catch {
      // Not even JSON: skip it like any other invalid post.
      return { key: o.key, parsed: null };
    }
  });
  const posts: Post[] = [];
  const skipped: string[] = [];
  for (const { key, parsed } of loaded) {
    if (parsed?.success) posts.push(parsed.data);
    else skipped.push(key);
  }

  const plan = planIndex(posts, config, now);
  await mapLimit([...plan], 16, ([key, value]) => store.putJson(key, value, key.startsWith('_system/') ? PRIVATE_JSON : CACHE_JSON));
  const stale = (await store.list(keys.indexPrefix)).map((o) => o.key).filter((k) => !plan.has(k));
  await store.deleteKeys(stale);

  const feeds = config.visibility === 'public' && opts.siteUrl !== null;
  if (feeds) {
    const visible = posts.filter((p) => !p.hidden && p.kind !== 'story' && config.kinds.includes(p.kind));
    const { json, rss } = buildFeeds(visible, await loadSite(store), { siteUrl: opts.siteUrl!, mediaPublicUrl: opts.mediaPublicUrl, now });
    await store.put(keys.feedJson, json, 'application/feed+json', CACHE_JSON);
    await store.put(keys.rss, rss, 'application/rss+xml', CACHE_JSON);
  } else {
    await store.deleteKeys([keys.feedJson, keys.rss]);
  }
  await store.putJson(keys.schema, postJsonSchema());

  jsonCache().clear();
  return { posts: posts.length, skipped: skipped.sort(), feeds };
}
