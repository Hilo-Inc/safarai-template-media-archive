import { describe, expect, it } from 'vitest';
import { demoCatalog } from '../../scripts/demo/catalog';

const posts = demoCatalog();
const all = posts.flatMap((p) => p.media);

describe('demoCatalog', () => {
  it('has 36 posts with unique shortcodes and gallery-dl dates', () => {
    expect(posts).toHaveLength(36);
    expect(new Set(posts.map((p) => p.shortcode)).size).toBe(36);
    for (const p of posts) expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('spreads dates over three years', () => {
    const years = new Set(posts.map((p) => p.date.slice(0, 4)));
    expect(years.size).toBeGreaterThanOrEqual(3);
  });

  it('has 4 carousels of 2 to 5 photos', () => {
    const carousels = posts.filter((p) => p.media.length > 1);
    expect(carousels).toHaveLength(4);
    for (const c of carousels) {
      expect(c.media.length).toBeGreaterThanOrEqual(2);
      expect(c.media.length).toBeLessThanOrEqual(5);
      expect(c.media.every((m) => m.type === 'image')).toBe(true);
    }
  });

  it('has 8 portrait and 3 landscape videos, and one audio track', () => {
    const videos = all.filter((m) => m.type === 'video');
    expect(videos.filter((v) => v.ratio === '9:16')).toHaveLength(8);
    expect(videos.filter((v) => v.ratio === '16:9')).toHaveLength(3);
    expect(all.filter((m) => m.type === 'audio')).toHaveLength(1);
  });

  it('uses every photo ratio, one pinned post, and hashtags shared by several posts', () => {
    const ratios = new Set(all.flatMap((m) => (m.type === 'image' ? [m.ratio] : [])));
    expect([...ratios].sort()).toEqual(['16:9', '1:1', '4:5', '9:16']);
    expect(posts.filter((p) => p.featured)).toHaveLength(1);
    for (const tag of ['#sunset', '#sea', '#hiking']) expect(posts.filter((p) => p.caption.includes(tag)).length).toBeGreaterThanOrEqual(3);
  });

  it('gives every image and video its own seed', () => {
    const seeds = all.flatMap((m) => (m.type === 'audio' ? [] : [m.seed]));
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});
