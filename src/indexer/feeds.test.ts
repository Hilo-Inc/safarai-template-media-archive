import { describe, expect, it } from 'vitest';
import { makePost } from '../../test/fixtures/posts';
import { DEFAULT_SITE } from '../schema/site';
import { buildFeeds } from './feeds';

const site = { ...DEFAULT_SITE, title: 'My archive', bio: 'Things I made' };
const now = new Date('2026-10-10T00:00:00.000Z');
const day = (n: number) => new Date(Date.UTC(2025, 0, 1) + n * 86_400_000).toISOString();

describe('buildFeeds', () => {
  it('lists the latest 50 posts, newest first, linking to the site', () => {
    const posts = Array.from({ length: 60 }, (_, i) => makePost(`files_p${i}`, day(i), { caption: `Post ${i}\nmore text` }));
    const { json, rss } = buildFeeds(posts, site, { siteUrl: 'https://a.example', mediaPublicUrl: null, now });
    const feed = JSON.parse(json);
    expect(feed.title).toBe('My archive');
    expect(feed.items).toHaveLength(50);
    expect(feed.items[0]).toMatchObject({ id: 'https://a.example/p/files_p59', url: 'https://a.example/p/files_p59', title: 'Post 59' });
    expect(feed.items[0].image).toBeUndefined();
    expect(rss).toContain('<rss');
    expect(rss).toContain('https://a.example/p/files_p59');
    expect(rss).not.toContain('files_p9<');
  });

  it('names an untitled post by its date', () => {
    const { json } = buildFeeds([makePost('files_a', '2025-05-04T10:00:00.000Z', { caption: '' })], site, {
      siteUrl: 'https://a.example',
      mediaPublicUrl: null,
      now,
    });
    expect(JSON.parse(json).items[0].title).toBe('Post from 2025-05-04');
  });

  it('adds images only from a public media address', () => {
    const { json } = buildFeeds([makePost('files_a', day(1))], site, { siteUrl: 'https://a.example', mediaPublicUrl: 'https://m.example', now });
    expect(JSON.parse(json).items[0].image).toBe('https://m.example/media/files_beach-day/0/w320.webp');
  });

  it('does not double slashes when addresses end in one', () => {
    const { json } = buildFeeds([makePost('files_a', day(1))], site, { siteUrl: 'https://a.example/', mediaPublicUrl: 'https://m.example/', now });
    const item = JSON.parse(json).items[0];
    expect(item.url).toBe('https://a.example/p/files_a');
    expect(item.image).toBe('https://m.example/media/files_beach-day/0/w320.webp');
  });
});
