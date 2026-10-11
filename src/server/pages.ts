import { loadConfig } from '../config/load';
import type { ArchiveConfig, Kind } from '../config/schema';
import { getEnv } from '../env';
import { TAG_RE } from '../indexer/plan-index';
import { readJson } from '../lib/json-cache';
import { keys } from '../lib/keys';
import { defaultSigner, signJsonPaths, type UrlSigner } from '../lib/media-url';
import type { Role } from '../lib/session';
import { KIND_LABELS, kindTabs, presetLook, type Look } from '../render/preset-look';
import type { IndexMeta, IndexPage } from '../schema/index-types';
import { POST_ID_RE, postSchema, type Post } from '../schema/post';
import { DEFAULT_SITE, siteSchema, type Site } from '../schema/site';

export interface PageDeps {
  read: <T>(key: string) => Promise<T | null>;
  sign: UrlSigner;
  config: ArchiveConfig;
  mediaPublicUrl: string | null;
}

export function pageDeps(): PageDeps {
  return { read: readJson, sign: defaultSigner(), config: loadConfig(), mediaPublicUrl: getEnv().mediaPublicUrl };
}

/** Bucket JSON, or null when the file is missing or not valid JSON (a hand edit): pages degrade instead of failing. Store errors still throw. */
async function readOrNull<T>(read: PageDeps['read'], key: string): Promise<T | null> {
  try {
    return await read<T>(key);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.warn(`${key} is not valid JSON`);
    return null;
  }
}

export async function readSite(read: PageDeps['read']): Promise<Site> {
  const parsed = siteSchema.safeParse((await readOrNull(read, keys.site)) ?? {});
  return parsed.success ? parsed.data : DEFAULT_SITE;
}

export interface Chrome {
  site: Site;
  avatarUrl: string | null;
  meta: IndexMeta | null;
  look: Look;
  tabs: { kind: Kind; label: string; count: number }[];
}

export async function loadChrome(deps: PageDeps): Promise<Chrome> {
  const [site, meta] = await Promise.all([readSite(deps.read), readOrNull<IndexMeta>(deps.read, keys.indexMeta)]);
  return {
    site,
    avatarUrl: site.avatar ? await deps.sign(site.avatar) : null,
    meta,
    look: presetLook(deps.config.preset),
    tabs: kindTabs(deps.config.kinds.filter((k) => k !== 'story'), meta?.counts.kinds ?? {}),
  };
}

export interface GridScope {
  /** Index scope: "all", "kind/<kind>" or "tag/<tag>". */
  scope: string;
  basePath: string;
  title: string | null;
}

export function gridScope(type: 'all' | 'kind' | 'tag', value: string | undefined, config: ArchiveConfig): GridScope | null {
  if (type === 'all') return { scope: 'all', basePath: '/', title: null };
  if (!value) return null;
  if (type === 'kind') {
    const kind = config.kinds.find((k) => k === value);
    if (!kind || kind === 'story') return null;
    return { scope: `kind/${kind}`, basePath: `/kind/${kind}`, title: KIND_LABELS[kind] };
  }
  // Tags are stored lowercase, so an uppercase tag URL has no index.
  if (!TAG_RE.test(value) || value !== value.toLowerCase()) return null;
  return { scope: `tag/${value}`, basePath: `/tags/${encodeURIComponent(value)}`, title: `#${value}` };
}

export function scopeFromParam(param: string | null, config: ArchiveConfig): GridScope | null {
  if (param === 'all') return gridScope('all', undefined, config);
  const match = /^(kind|tag)\/([^/]+)$/.exec(param ?? '');
  return match ? gridScope(match[1] as 'kind' | 'tag', match[2], config) : null;
}

export function parsePage(raw: string | null): number | null {
  if (raw === null) return 1;
  return /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : null;
}

export async function loadGrid(scope: GridScope, page: number, deps: PageDeps): Promise<IndexPage | null> {
  const data = await readOrNull<IndexPage>(deps.read, keys.indexPage(scope.scope, page));
  if (!data) return scope.scope === 'all' && page === 1 ? { page: 1, pages: 1, posts: [] } : null;
  return signJsonPaths(data, deps.sign);
}

/** A tag page's post count, when the whole tag fits on one page (the index stores page counts, not post counts). */
export function tagPostCount(page: IndexPage): number | null {
  return page.pages === 1 ? page.posts.length : null;
}

export async function loadPost(id: string, role: Role | null, deps: PageDeps): Promise<Post | null> {
  if (!POST_ID_RE.test(id) || id.length > 120) return null;
  const parsed = postSchema.safeParse(await readOrNull(deps.read, keys.post(id)));
  if (!parsed.success) return null;
  const post = parsed.data;
  if (role !== 'admin' && (post.hidden || !deps.config.kinds.includes(post.kind))) return null;
  return signJsonPaths(post, deps.sign);
}

/** Link-preview image for a signed post: public mode with a media domain only. */
export function ogImage(post: Post, deps: PageDeps): string | null {
  if (deps.config.visibility !== 'public' || !deps.mediaPublicUrl) return null;
  const first = post.media[0];
  const variants = first?.type === 'image' ? first.variants : first?.type === 'video' ? (first.poster?.variants ?? []) : [];
  const largest = [...variants].sort((a, b) => b.w - a.w)[0];
  if (largest) return largest.src;
  if (first?.type === 'image') return first.src;
  return first?.type === 'video' ? (first.poster?.src ?? null) : null;
}

/** An absolute URL on the site's own address (from env), or null when that is unknown. Never built from the request's Host header. */
export function absoluteUrl(siteUrl: string | null, path: string): string | null {
  return siteUrl ? `${siteUrl.replace(/\/+$/, '')}${path}` : null;
}
