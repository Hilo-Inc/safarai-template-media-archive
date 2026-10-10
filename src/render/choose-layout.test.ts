import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../schema/post';
import { makePost } from '../../test/fixtures/posts';
import { chooseLayout, srcset, VERTICAL_ASPECT } from './choose-layout';

const image = (width: number, height: number): MediaItem => ({
  type: 'image',
  src: 'media/x/0/orig.jpg',
  width,
  height,
  orientation: width / height < 0.8 ? 'portrait' : width / height > 1.25 ? 'landscape' : 'square',
  alt: null,
  thumbhash: null,
  variants: [],
});
const video = (width: number, height: number, orientation: 'portrait' | 'square' | 'landscape'): MediaItem => ({
  type: 'video',
  src: 'media/x/0/orig.mp4',
  width,
  height,
  orientation,
  duration: 12,
  playable: true,
  poster: null,
  subtitles: [],
});
const audio: MediaItem = { type: 'audio', src: 'media/x/0/orig.mp3', duration: 90, peaks: null };
const post = (media: MediaItem[], kind: 'post' | 'story' = 'post') => makePost('files_x', '2025-01-01T00:00:00.000Z', { media, kind });

describe('chooseLayout (the spec rendering table)', () => {
  it('more than one item: carousel sized to the first item', () => {
    expect(chooseLayout(post([image(1080, 1350), image(1080, 1080)]))).toEqual({ kind: 'carousel', aspect: 0.8 });
  });

  it('portrait video: vertical 9:16 player', () => {
    expect(chooseLayout(post([video(720, 1280, 'portrait')]))).toEqual({ kind: 'vertical-video', aspect: VERTICAL_ASPECT });
    expect(chooseLayout(post([video(1000, 1300, 'portrait')]))).toEqual({ kind: 'vertical-video', aspect: VERTICAL_ASPECT });
  });

  it('landscape and square video: player at its own aspect', () => {
    expect(chooseLayout(post([video(1920, 1080, 'landscape')]))).toEqual({ kind: 'video', aspect: 1920 / 1080 });
    expect(chooseLayout(post([video(1080, 1080, 'square')]))).toEqual({ kind: 'video', aspect: 1 });
  });

  it('image: its own aspect', () => {
    expect(chooseLayout(post([image(2048, 1024)]))).toEqual({ kind: 'image', aspect: 2 });
  });

  it('audio: waveform player', () => {
    expect(chooseLayout(post([audio]))).toEqual({ kind: 'audio' });
  });

  it('a story is only for the stories viewer, whatever its media', () => {
    expect(chooseLayout(post([image(1080, 1920)], 'story'))).toEqual({ kind: 'story' });
  });

  it('no media: text card', () => {
    expect(chooseLayout({ kind: 'post', media: [] })).toEqual({ kind: 'text' });
  });

  it('a carousel starting with audio is square', () => {
    expect(chooseLayout(post([audio, image(100, 50)]))).toEqual({ kind: 'carousel', aspect: 1 });
  });
});

describe('srcset', () => {
  it('lists variants smallest first with their widths', () => {
    expect(srcset([{ w: 1280, src: 'b' }, { w: 320, src: 'a' }])).toBe('a 320w, b 1280w');
    expect(srcset([])).toBe('');
  });
});
