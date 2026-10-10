import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import { presetLook } from '../render/preset-look';
import type { IndexPage, PostSummary } from '../schema/index-types';
import type { MediaItem as Item } from '../schema/post';
import { samplePost } from '../../test/fixtures/posts';
import Grid from './Grid.astro';
import MediaItem from './MediaItem.astro';
import Post from './Post.astro';
import Tile from './Tile.astro';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const video = (extra: Partial<Extract<Item, { type: 'video' }>> = {}): Item => ({
  type: 'video',
  src: 'https://m/v.mkv',
  width: 1920,
  height: 1080,
  orientation: 'landscape',
  duration: 12,
  playable: true,
  poster: { src: 'https://m/poster.webp', width: 1920, height: 1080, variants: [], thumbhash: null },
  subtitles: [],
  ...extra,
});

const summary = (extra: Partial<PostSummary> = {}): PostSummary => ({
  id: 'files_a',
  kind: 'video',
  platform: 'files',
  published: '2025-01-01T00:00:00.000Z',
  caption: 'First line\nsecond',
  cover: { type: 'video', src: 'https://m/poster.webp', width: 1920, height: 1080, thumbhash: null, variants: [] },
  count: 1,
  duration: 75,
  featured: false,
  ...extra,
});

describe('MediaItem', () => {
  it('unplayable video shows a download link', async () => {
    const html = await container.renderToString(MediaItem, { props: { item: video({ playable: false }) } });
    expect(html).not.toContain('<video');
    expect(html).toContain('src="https://m/poster.webp"');
    expect(html).toMatch(/<a[^>]+href="https:\/\/m\/v\.mkv"[^>]*download/);
  });

  it('playable video gets controls, a poster and subtitle tracks', async () => {
    const html = await container.renderToString(MediaItem, {
      props: { item: video({ subtitles: [{ src: 'https://m/subs.vtt', lang: 'en' }] }) },
    });
    expect(html).toContain('<media-controller');
    expect(html).toMatch(/<video[^>]+poster="https:\/\/m\/poster\.webp"/);
    expect(html).toMatch(/<track[^>]+src="https:\/\/m\/subs\.vtt"[^>]+srclang="en"/);
    expect(html).toContain('crossorigin="anonymous"');
  });

  it('image uses srcset and the alt text', async () => {
    const html = await container.renderToString(MediaItem, {
      props: { item: { ...samplePost.media[0]!, alt: 'Sea', variants: [{ w: 320, src: 'https://m/w320' }, { w: 640, src: 'https://m/w640' }] } },
    });
    expect(html).toContain('srcset="https://m/w320 320w, https://m/w640 640w"');
    expect(html).toContain('alt="Sea"');
  });

  it('audio keeps a native player and passes peaks to the waveform', async () => {
    const html = await container.renderToString(MediaItem, {
      props: { item: { type: 'audio', src: 'https://m/a.mp3', duration: 61, peaks: 'https://m/peaks.json' } },
    });
    expect(html).toMatch(/<audio[^>]+controls[^>]+src="https:\/\/m\/a\.mp3"/);
    expect(html).toContain('data-peaks="https://m/peaks.json"');
  });
});

describe('Tile', () => {
  it('shows a duration badge only for looks that want one', async () => {
    const youtube = await container.renderToString(Tile, { props: { post: summary(), look: presetLook('youtube') } });
    const generic = await container.renderToString(Tile, { props: { post: summary(), look: presetLook('generic') } });
    expect(youtube).toContain('1:15');
    expect(generic).not.toContain('1:15');
    expect(youtube).toContain('href="/p/files_a"');
  });

  it('marks carousels and shows text for posts without a cover', async () => {
    const multi = await container.renderToString(Tile, { props: { post: summary({ count: 3 }), look: presetLook('generic') } });
    expect(multi).toContain('3 items');
    const text = await container.renderToString(Tile, { props: { post: summary({ cover: null, kind: 'post' }), look: presetLook('generic') } });
    expect(text).toContain('First line');
    expect(text).not.toContain('second');
  });
});

describe('Post', () => {
  it('links tags, keeps mentions as text in "text" mode, and shows the date', async () => {
    const post = { ...samplePost, caption: 'Beach day #summer with @friend' };
    const html = await container.renderToString(Post, { props: { post, mentions: 'text' } });
    expect(html).toContain('href="/tags/summer"');
    expect(html).toContain('@friend');
    expect(html).not.toContain('instagram.com/friend');
    expect(html).toContain('10 Feb 2025');
  });

  it('labels a hidden post', async () => {
    const html = await container.renderToString(Post, { props: { post: { ...samplePost, hidden: true }, mentions: 'text' } });
    expect(html).toContain('Hidden');
  });
});

describe('Grid', () => {
  const page = (n: number, pages: number): IndexPage => ({ page: n, pages, posts: [summary()] });
  const scope = { scope: 'kind/video', basePath: '/kind/video', title: 'Videos' };

  it('links to the next page for scripts and for plain browsers', async () => {
    const html = await container.renderToString(Grid, { props: { page: page(1, 3), scope, look: presetLook('generic'), isOwner: false } });
    expect(html).toContain('href="/kind/video?page=2"');
    expect(html).toContain('data-fragment="/fragments/grid?scope=kind%2Fvideo&amp;page=2"');
  });

  it('has no next link on the last page, and an empty message on an empty first page', async () => {
    expect(await container.renderToString(Grid, { props: { page: page(3, 3), scope, look: presetLook('generic'), isOwner: false } })).not.toContain('data-more');
    const empty = await container.renderToString(Grid, { props: { page: { page: 1, pages: 1, posts: [] }, scope, look: presetLook('generic'), isOwner: true } });
    expect(empty).toContain('Nothing here yet');
    expect(empty).toContain('href="/admin"');
  });
});
