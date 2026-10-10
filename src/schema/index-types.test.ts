import { describe, expect, it } from 'vitest';
import { samplePost } from '../../test/fixtures/posts';
import { summarize } from './index-types';

describe('summarize', () => {
  it('uses the first image as the cover', () => {
    const s = summarize(samplePost);
    expect(s).toEqual({
      id: 'files_beach-day',
      kind: 'post',
      platform: 'files',
      published: '2025-02-10T12:00:00.000Z',
      caption: 'Beach day #summer',
      cover: {
        type: 'image',
        src: 'media/files_beach-day/0/orig.jpg',
        width: 1080,
        height: 1350,
        thumbhash: 'AAAA',
        variants: [{ w: 320, src: 'media/files_beach-day/0/w320.webp' }],
      },
      count: 1,
      duration: null,
      featured: false,
    });
  });

  it('uses a video poster, keeps the duration and truncates long captions', () => {
    const s = summarize({
      ...samplePost,
      caption: 'a'.repeat(200),
      media: [
        {
          type: 'video',
          src: 'media/x/0/orig.mp4',
          width: 720,
          height: 1280,
          orientation: 'portrait',
          duration: 30,
          playable: true,
          poster: { src: 'media/x/0/poster.webp', width: 720, height: 1280, variants: [], thumbhash: 'BB' },
          subtitles: [],
        },
      ],
    });
    expect(s.cover).toEqual({ type: 'video', src: 'media/x/0/poster.webp', width: 720, height: 1280, thumbhash: 'BB', variants: [] });
    expect(s.duration).toBe(30);
    expect(s.caption).toHaveLength(140);
    expect(s.caption.endsWith('…')).toBe(true);
  });

  it('has no cover for audio', () => {
    const s = summarize({ ...samplePost, media: [{ type: 'audio', src: 'media/x/0/orig.mp3', duration: 90, peaks: null }] });
    expect(s.cover).toBeNull();
    expect(s.duration).toBe(90);
  });
});
