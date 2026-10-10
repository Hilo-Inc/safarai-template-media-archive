/** Media never changes once written (re-imports write the same bytes or new posts). */
export const CACHE_MEDIA = 'public, max-age=86400';
/** Index and post JSON change on every import. */
export const CACHE_JSON = 'public, max-age=60';

export function pageName(n: number): string {
  return `${String(n).padStart(4, '0')}.json`;
}

export const keys = {
  post: (id: string) => `posts/${id}.json`,
  postsPrefix: 'posts/',
  media: (postId: string, n: number, name: string) => `media/${postId}/${n}/${name}`,
  mediaPrefix: (postId: string) => `media/${postId}/`,
  importPrefix: (id: string) => `imports/${id}/`,
  importStatus: (id: string) => `_system/imports/${id}.json`,
  importStatusPrefix: '_system/imports/',
  /** The files the browser said it would upload for one import (written by POST /api/imports). */
  importManifest: (id: string) => `_system/manifests/${id}.json`,
  manifestPrefix: '_system/manifests/',
  overrides: '_system/overrides.json',
  site: '_system/site.json',
  adminIndex: '_system/admin-index.json',
  indexPrefix: 'index/',
  indexMeta: 'index/meta.json',
  /** scope: "all", "<platform>", "kind/<kind>" or "tag/<tag>". */
  indexPage: (scope: string, page: number) => `index/${scope}/${pageName(page)}`,
  storyMonth: (month: string) => `index/stories/${month}.json`,
  avatar: (version: string) => `media/site/avatar-${version}.webp`,
  avatarPrefix: 'media/site/',
  inbox: 'inbox/',
  feedJson: 'feed.json',
  rss: 'rss.xml',
  schema: 'schema/post.v1.json',
} as const;

export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
