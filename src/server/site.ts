import sharp from 'sharp';
import { CACHE_MEDIA, keys } from '../lib/keys';
import { loadSite, saveSite } from '../lib/site';
import type { Store } from '../lib/store';
import { siteInputSchema } from '../schema/site';
import { fail, json, parseWith } from './http';
import type { QueueLike } from './imports';

export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const AVATAR_SIZE = 320;

export async function updateSite(store: Store, queue: QueueLike, body: unknown): Promise<Response> {
  const parsed = parseWith(siteInputSchema, body);
  if (!parsed.ok) return parsed.response;
  const site = { ...(await loadSite(store)), ...parsed.data };
  await saveSite(store, site);
  void queue.requestRebuild(); // the feed title and description come from the site
  return json(200, { site });
}

/** A square WebP for the site avatar. Re-encoding drops all metadata. Throws when the input is not an image. */
export async function avatarWebp(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
}

/**
 * Saves a new avatar version, removes the older ones and points site.json at it.
 * With `onlyIfUnset`, site.json is read again after the upload: an avatar the owner set in the meantime is kept
 * untouched (nothing is overwritten or deleted) and this returns null.
 */
export async function storeAvatar(store: Store, webp: Buffer): Promise<string>;
export async function storeAvatar(store: Store, webp: Buffer, opts: { onlyIfUnset: true }): Promise<string | null>;
export async function storeAvatar(store: Store, webp: Buffer, opts?: { onlyIfUnset: true }): Promise<string | null> {
  const key = keys.avatar(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  await store.put(key, webp, 'image/webp', CACHE_MEDIA);
  if (opts?.onlyIfUnset && (await loadSite(store)).avatar) {
    await store.deleteKeys([key]);
    return null;
  }
  const old = (await store.list(keys.avatarPrefix)).map((o) => o.key).filter((k) => k !== key && k.startsWith(`${keys.avatarPrefix}avatar-`));
  await store.deleteKeys(old);
  await saveSite(store, { ...(await loadSite(store)), avatar: key });
  return key;
}

export async function uploadAvatar(store: Store, form: FormData): Promise<Response> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return fail(400, 'Choose an image');
  if (file.size > MAX_AVATAR_BYTES) return fail(413, 'The image must be 10 MB or smaller');
  let webp: Buffer;
  try {
    webp = await avatarWebp(Buffer.from(await file.arrayBuffer()));
  } catch {
    return fail(400, 'That file is not an image');
  }
  return json(200, { avatar: await storeAvatar(store, webp) });
}
