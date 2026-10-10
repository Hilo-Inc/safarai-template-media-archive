import { z } from 'zod';
import { keys } from '../lib/keys';
import { shared } from '../lib/shared';
import { PRIVATE_JSON } from '../lib/site';
import type { Store } from '../lib/store';
import { postSchema, type Post } from '../schema/post';

export const MAX_FEATURED = 3;

export const postPatchSchema = z.strictObject({
  hidden: z.boolean().optional(),
  featured: z.boolean().optional(),
  caption: z.string().max(5000).optional(),
  /** Alt text by media item index ("0", "1", …); null clears it. */
  alt: z.record(z.string().regex(/^\d{1,3}$/), z.string().trim().max(1000).nullable()).optional(),
  /** Place name; null or "" removes it (coordinates, if any, stay). */
  place: z.string().trim().max(200).nullable().optional(),
});
export type PostPatch = z.infer<typeof postPatchSchema>;

const editSchema = postPatchSchema.pick({ caption: true, alt: true, place: true });
export type PostEdit = z.infer<typeof editSchema>;

const overridesSchema = z.object({
  hidden: z.array(z.string()).default([]),
  featured: z.array(z.string()).default([]),
  edits: z.record(z.string(), editSchema).default({}),
});
export type Overrides = z.infer<typeof overridesSchema>;

export class OverrideError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = 'OverrideError';
  }
}

/** Runs fn after every earlier call has finished, so read-modify-write of overrides and posts never interleave. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const lock = shared('overrides-lock', () => ({ tail: Promise.resolve() as Promise<unknown> }));
  const run = lock.tail.then(fn, fn);
  lock.tail = run.catch(() => undefined);
  return run;
}

export async function readOverrides(store: Store): Promise<Overrides> {
  const raw = await store.getJson(keys.overrides);
  if (raw === null) return overridesSchema.parse({});
  // Present but unreadable: stop. Treating it as empty would publish hidden posts and the next edit would overwrite the file.
  const parsed = overridesSchema.safeParse(raw);
  if (!parsed.success) throw new Error('The saved post overrides are not valid');
  return parsed.data;
}

function withPlace(location: Post['location'], place: string | null | undefined): Post['location'] {
  const coords = location && 'lat' in location ? { lat: location.lat, lng: location.lng } : null;
  if (place) return coords ? { ...coords, name: place } : { name: place };
  return coords;
}

export function applyOverrides(post: Post, overrides: Overrides): Post {
  const out: Post = { ...post, hidden: overrides.hidden.includes(post.id), featured: overrides.featured.includes(post.id) };
  const edit = overrides.edits[post.id];
  if (!edit) return out;
  if (edit.caption !== undefined) out.caption = edit.caption;
  if (edit.alt) {
    const alt = edit.alt;
    out.media = out.media.map((m, n) => (m.type === 'image' && String(n) in alt ? { ...m, alt: alt[String(n)] || null } : m));
  }
  if (edit.place !== undefined) out.location = withPlace(out.location, edit.place);
  return out;
}

/** Writes a post with the owner's overrides applied. Every post write goes through here. */
export function writePost(store: Store, post: Post): Promise<Post> {
  return serial(async () => {
    const out = applyOverrides(post, await readOverrides(store));
    await store.putJson(keys.post(post.id), out);
    return out;
  });
}

/** Records an edit from the admin Posts page and rewrites that post. The caller rebuilds the index. */
export function updatePost(store: Store, id: string, patch: PostPatch): Promise<Post> {
  return serial(async () => {
    const current = postSchema.safeParse(await store.getJson(keys.post(id)));
    if (!current.success) throw new OverrideError('No such post', 404);
    const o = await readOverrides(store);
    const toggle = (list: string[], on: boolean | undefined) => (on === undefined ? list : on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
    const featured = toggle(o.featured, patch.featured);
    if (featured.length > MAX_FEATURED) throw new OverrideError(`You can feature up to ${MAX_FEATURED} posts`, 409);
    const { hidden: _h, featured: _f, ...edit } = patch;
    const before = o.edits[id] ?? {};
    const next: Overrides = {
      hidden: toggle(o.hidden, patch.hidden),
      featured,
      edits: { ...o.edits, [id]: { ...before, ...edit, ...(edit.alt ? { alt: { ...before.alt, ...edit.alt } } : {}) } },
    };
    if (Object.keys(next.edits[id]!).length === 0) delete next.edits[id];
    await store.putJson(keys.overrides, next, PRIVATE_JSON);
    const out = applyOverrides(current.data, next);
    await store.putJson(keys.post(id), out);
    return out;
  });
}
