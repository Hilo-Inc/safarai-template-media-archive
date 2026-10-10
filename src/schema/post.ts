import { z } from 'zod';
import { KINDS } from '../config/schema';

export const POST_ID_RE = /^[a-z0-9-]+_[A-Za-z0-9._-]+$/;
export const ORIENTATIONS = ['portrait', 'square', 'landscape'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** An absolute http(s) URL; rejects javascript:, data: and other schemes. */
export const httpUrl = z.url({ protocol: /^https?$/ });

const key = z.string().min(1).max(1024);
const dimension = z.number().int().positive();

export const variantSchema = z.strictObject({ w: dimension, src: key });

export const posterSchema = z.strictObject({
  src: key,
  width: dimension,
  height: dimension,
  variants: z.array(variantSchema),
  thumbhash: z.string().nullable(),
});

export const imageItemSchema = z.strictObject({
  type: z.literal('image'),
  src: key,
  width: dimension,
  height: dimension,
  orientation: z.enum(ORIENTATIONS),
  alt: z.string().nullable(),
  thumbhash: z.string().nullable(),
  variants: z.array(variantSchema),
});

export const videoItemSchema = z.strictObject({
  type: z.literal('video'),
  src: key,
  width: dimension,
  height: dimension,
  orientation: z.enum(ORIENTATIONS),
  duration: z.number().nonnegative(),
  playable: z.boolean(),
  poster: posterSchema.nullable(),
  subtitles: z.array(z.strictObject({ src: key, lang: z.string().nullable() })),
});

export const audioItemSchema = z.strictObject({
  type: z.literal('audio'),
  src: key,
  duration: z.number().nonnegative(),
  peaks: key.nullable(),
});

export const mediaItemSchema = z.discriminatedUnion('type', [imageItemSchema, videoItemSchema, audioItemSchema]);

const locationSchema = z.union([
  z.null(),
  z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().optional() }),
  z.strictObject({ name: z.string().min(1) }),
]);

export const postSchema = z.strictObject({
  schema: z.literal(1),
  id: z.string().regex(POST_ID_RE).max(120),
  platform: z.string().regex(/^[a-z0-9-]{1,32}$/),
  kind: z.enum(KINDS),
  published: z.iso.datetime(),
  importedAt: z.iso.datetime(),
  caption: z.string(),
  tags: z.array(z.string()),
  sourceUrl: httpUrl.nullable(),
  location: locationSchema,
  music: z.strictObject({ genre: z.string() }).nullable(),
  hidden: z.boolean(),
  featured: z.boolean(),
  media: z.array(mediaItemSchema).min(1),
});

export type Variant = z.infer<typeof variantSchema>;
export type Poster = z.infer<typeof posterSchema>;
export type ImageItem = z.infer<typeof imageItemSchema>;
export type VideoItem = z.infer<typeof videoItemSchema>;
export type AudioItem = z.infer<typeof audioItemSchema>;
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type Post = z.infer<typeof postSchema>;

/** The JSON Schema written to schema/post.v1.json. */
export function postJsonSchema(): object {
  return { $id: 'post.v1.json', title: 'Media archive post (schema 1)', ...z.toJSONSchema(postSchema) };
}
