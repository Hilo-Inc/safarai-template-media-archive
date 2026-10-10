import type { Post } from '../../src/schema/post';

export const samplePost: Post = {
  schema: 1,
  id: 'files_beach-day',
  platform: 'files',
  kind: 'post',
  published: '2025-02-10T12:00:00.000Z',
  importedAt: '2026-10-10T09:00:00.000Z',
  caption: 'Beach day #summer',
  tags: ['summer'],
  sourceUrl: null,
  location: null,
  music: null,
  hidden: false,
  featured: false,
  media: [
    {
      type: 'image',
      src: 'media/files_beach-day/0/orig.jpg',
      width: 1080,
      height: 1350,
      orientation: 'portrait',
      alt: null,
      thumbhash: 'AAAA',
      variants: [{ w: 320, src: 'media/files_beach-day/0/w320.webp' }],
    },
  ],
};

/** A copy of samplePost with a different id, date and overrides. */
export function makePost(id: string, published: string, extra: Partial<Post> = {}): Post {
  const [platform] = id.split('_');
  return { ...samplePost, id, platform: platform!, published, ...extra };
}
