import { describe, expect, it } from 'vitest';
import { makePost } from '../../test/fixtures/posts';
import { DEFAULT_SITE } from '../schema/site';
import { buildFeeds } from './feeds';

const site = { ...DEFAULT_SITE, title: 'My archive', bio: 'Things I made' };
const kinds = ['post', 'video', 'story'];
const now = new Date('2026-10-10T00:00:00.000Z');
const day = (n: number) => new Date(Date.UTC(2025, 0, 1) + n * 86_400_000).toISOString();

describe('buildFeeds', () => {
  it('lists the latest 50 posts, newest first, linking to the site', () => {
    const posts = Array.from({ length: 60 }, (_, i) => makePost(`files_p${i}`, day(i), { caption: `Post ${i}\nmore text` }));
    const { json, rss } = buildFeeds(posts, site, { siteUrl: 'https://a.example', mediaPublicUrl: null, kinds, now });
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
      kinds,
      now,
    });
    expect(JSON.parse(json).items[0].title).toBe('Post from 2025-05-04');
  });

  it('adds images only from a public media address', () => {
    const { json } = buildFeeds([makePost('files_a', day(1))], site, { siteUrl: 'https://a.example', mediaPublicUrl: 'https://m.example', kinds, now });
    expect(JSON.parse(json).items[0].image).toBe('https://m.example/media/files_beach-day/0/w320.webp');
  });

  it('does not double slashes when addresses end in one', () => {
    const { json } = buildFeeds([makePost('files_a', day(1))], site, { siteUrl: 'https://a.example/', mediaPublicUrl: 'https://m.example/', kinds, now });
    const item = JSON.parse(json).items[0];
    expect(item.url).toBe('https://a.example/p/files_a');
    expect(item.image).toBe('https://m.example/media/files_beach-day/0/w320.webp');
  });

  it('escapes captions so markup never reaches content_html or the description', () => {
    const caption = `<script>alert(1)</script>
<img src=x onerror=alert(1)>
a & b ]]> "q" 'r'`;
    const { json, rss } = buildFeeds([makePost('files_a', day(1), { caption })], site, {
      siteUrl: 'https://a.example',
      mediaPublicUrl: null,
      kinds,
      now,
    });
    const item = JSON.parse(json).items[0];
    // Titles are plain text by spec; the HTML-bearing fields are the item description and content:encoded.
    const rssItem = rss.slice(rss.indexOf('</title>', rss.indexOf('<item>')));
    for (const text of [item.content_html, item.summary, rssItem]) {
      expect(text).not.toContain('<script');
      expect(text).not.toContain('<img');
      expect(text).not.toMatch(/<[^>]*onerror=/); // escaped, the word is inert text; no tag can carry it
    }
    expect(item.content_html).toContain('a &amp; b');
    expect(item.content_html).toContain('<br>');
    expect(rss.match(/<!\[CDATA\[/g)!.length).toBeGreaterThan(0);
    expect(rss).not.toMatch(/\]\]>[^<]/);
  });

  it('leaves hidden, disabled-kind and story posts out of both feeds', () => {
    const posts = [
      makePost('files_ok', day(1)),
      makePost('files_hid', day(2), { hidden: true }),
      makePost('files_off', day(3), { kind: 'track' }),
      makePost('files_story', day(4), { kind: 'story' }),
    ];
    const { json, rss } = buildFeeds(posts, site, { siteUrl: 'https://a.example', mediaPublicUrl: null, kinds, now });
    expect(JSON.parse(json).items.map((i: { id: string }) => i.id)).toEqual(['https://a.example/p/files_ok']);
    for (const id of ['files_hid', 'files_off', 'files_story']) expect(rss).not.toContain(id);
  });
});
