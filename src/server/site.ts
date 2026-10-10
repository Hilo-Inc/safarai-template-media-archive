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

/** Square-crops, resizes and re-encodes the image (which drops all metadata) under a new name. */
export async function uploadAvatar(store: Store, form: FormData): Promise<Response> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return fail(400, 'Choose an image');
  if (file.size > MAX_AVATAR_BYTES) return fail(413, 'The image must be 10 MB or smaller');
  let webp: Buffer;
  try {
    webp = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    return fail(400, 'That file is not an image');
  }
  const key = keys.avatar(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  await store.put(key, webp, 'image/webp', CACHE_MEDIA);
  const old = (await store.list(keys.avatarPrefix)).map((o) => o.key).filter((k) => k !== key && k.startsWith(`${keys.avatarPrefix}avatar-`));
  await store.deleteKeys(old);
  await saveSite(store, { ...(await loadSite(store)), avatar: key });
  return json(200, { avatar: key });
}
