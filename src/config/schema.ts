import { z } from 'zod';

export const PRESETS = ['instagram', 'tiktok', 'youtube', 'soundcloud', 'facebook', 'generic'] as const;
export const VISIBILITIES = ['public', 'password'] as const;
export const KINDS = ['post', 'reel', 'story', 'igtv', 'video', 'short', 'track'] as const;
export const EXCLUDE = ['archived', 'deleted', 'draft'] as const;
export const LOCATIONS = ['none', 'place', 'rounded', 'exact'] as const;
export const MENTIONS = ['text', 'link'] as const;

export type Preset = (typeof PRESETS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type Kind = (typeof KINDS)[number];
export type LocationMode = (typeof LOCATIONS)[number];
export type MentionsMode = (typeof MENTIONS)[number];

/** The kinds a preset shows when archive.config.json does not list them. */
export const PRESET_KINDS: Record<Preset, readonly Kind[]> = {
  instagram: ['post', 'reel', 'story'],
  tiktok: ['video'],
  youtube: ['video', 'short'],
  soundcloud: ['track'],
  facebook: ['post', 'video', 'story'],
  generic: KINDS,
};

export const configSchema = z
  .strictObject({
    preset: z.enum(PRESETS).default('generic'),
    visibility: z.enum(VISIBILITIES).default('public'),
    kinds: z.array(z.enum(KINDS)).min(1).optional(),
    // Fixed: listed in the file only so the owner can see what is always left out.
    exclude: z
      .array(z.enum(EXCLUDE))
      .optional()
      .refine((v) => !v || EXCLUDE.every((e) => v.includes(e)), { message: `is fixed and must list ${EXCLUDE.join(', ')}` }),
    location: z.enum(LOCATIONS).default('none'),
    mentions: z.enum(MENTIONS).default('text'),
  })
  .transform((c) => ({ ...c, kinds: c.kinds ?? [...PRESET_KINDS[c.preset]], exclude: [...EXCLUDE] }));

export type ArchiveConfig = z.output<typeof configSchema>;
