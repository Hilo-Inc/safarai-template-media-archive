import { describe, expect, it } from 'vitest';
import { samplePost } from '../../test/fixtures/posts';
import { postJsonSchema, postSchema } from './post';

describe('postSchema', () => {
  it('accepts a valid post', () => {
    expect(postSchema.parse(samplePost)).toEqual(samplePost);
  });

  it('accepts video and audio items', () => {
    const post = {
      ...samplePost,
      media: [
        {
          type: 'video',
          src: 'media/x/0/orig.mp4',
          width: 720,
          height: 1280,
          orientation: 'portrait',
          duration: 12.5,
          playable: true,
          poster: { src: 'media/x/0/poster.webp', width: 720, height: 1280, variants: [], thumbhash: null },
          subtitles: [{ src: 'media/x/0/subs.en.vtt', lang: 'en' }],
        },
        { type: 'audio', src: 'media/x/1/orig.mp3', duration: 200, peaks: 'media/x/1/peaks.json' },
      ],
    };
    expect(postSchema.parse(post).media).toHaveLength(2);
  });

  it('rejects an id that does not start with the platform', () => {
    expect(() => postSchema.parse({ ...samplePost, id: 'beach-day' })).toThrow();
    expect(() => postSchema.parse({ ...samplePost, id: 'files_../x' })).toThrow();
  });

  it('rejects a post without media and unknown fields', () => {
    expect(() => postSchema.parse({ ...samplePost, media: [] })).toThrow();
    expect(() => postSchema.parse({ ...samplePost, device_id: 'abc' })).toThrow();
  });

  it('accepts only http(s) source URLs', () => {
    expect(() => postSchema.parse({ ...samplePost, sourceUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => postSchema.parse({ ...samplePost, sourceUrl: 'data:text/html,<script>1</script>' })).toThrow();
    expect(postSchema.parse({ ...samplePost, sourceUrl: 'https://example.com/p/1' }).sourceUrl).toBe('https://example.com/p/1');
  });

  it('exports a JSON Schema', () => {
    const schema = postJsonSchema() as { type: string; required: string[] };
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('media');
  });
});
