import { z } from 'zod';
import { httpUrl } from './post';

export const siteInputSchema = z.strictObject({
  title: z.string().trim().max(80),
  bio: z.string().trim().max(500),
  links: z.array(z.strictObject({ label: z.string().trim().min(1).max(40), url: httpUrl })).max(5),
});

export const siteSchema = z.object({
  title: z.string().max(80).default('Archive'),
  bio: z.string().max(500).default(''),
  links: siteInputSchema.shape.links.default([]),
  /** Bucket key of the avatar image (media/site/avatar-<version>.webp), or null. */
  avatar: z.string().nullable().default(null),
});

export type Site = z.infer<typeof siteSchema>;
export type SiteInput = z.infer<typeof siteInputSchema>;
export const DEFAULT_SITE: Site = siteSchema.parse({});
