import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE, siteInputSchema, siteSchema } from './site';

describe('site schema', () => {
  it('has defaults', () => {
    expect(siteSchema.parse({})).toEqual(DEFAULT_SITE);
  });

  it('limits title, bio and links', () => {
    expect(() => siteInputSchema.parse({ title: 'x'.repeat(81), bio: '', links: [] })).toThrow();
    expect(() => siteInputSchema.parse({ title: 'A', bio: 'x'.repeat(501), links: [] })).toThrow();
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: `https://e.com/${i}` }));
    expect(() => siteInputSchema.parse({ title: 'A', bio: '', links: six })).toThrow();
  });

  it('accepts only http(s) links', () => {
    expect(() => siteInputSchema.parse({ title: 'A', bio: '', links: [{ label: 'x', url: 'javascript:alert(1)' }] })).toThrow();
    expect(siteInputSchema.parse({ title: 'A', bio: '', links: [{ label: 'Shop', url: 'https://shop.example.com' }] }).links).toHaveLength(1);
  });
});
