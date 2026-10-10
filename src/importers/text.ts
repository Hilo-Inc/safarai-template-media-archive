export function hashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) out.add(m[1]!.toLowerCase());
  return [...out];
}

/** A post id part: [A-Za-z0-9._-], no leading/trailing separators, at most 80 characters. */
export function slugId(raw: string): string {
  const s = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
    .replace(/[-.]+$/g, '');
  return s || 'x';
}

/** Names that would collide with index scopes (index/all, index/kind, index/tag, index/stories, index/meta.json). */
export const RESERVED_PLATFORMS = new Set(['all', 'kind', 'stories', 'tag', 'meta']);

export function safePlatform(raw: unknown): string {
  if (typeof raw !== 'string') return 'files';
  const p = raw.split(':')[0]!.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(p) || RESERVED_PLATFORMS.has(p)) return 'files';
  return p;
}

/** First 8 hex characters of SHA-1 (Web Crypto, so it runs in the browser and in Node). */
export async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function extOf(path: string): string {
  const name = baseName(path);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}
