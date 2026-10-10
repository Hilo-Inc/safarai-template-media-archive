import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE } from '../schema/site';
import { loadSite, siteUrl } from './site';
import type { Store } from './store';

const fakeStore = (value: unknown) => ({ getJson: async () => value }) as unknown as Store;

describe('site', () => {
  it('loads the saved site, or defaults when missing or invalid', async () => {
    expect(await loadSite(fakeStore({ ...DEFAULT_SITE, title: 'Mine' }))).toMatchObject({ title: 'Mine' });
    expect(await loadSite(fakeStore(null))).toEqual(DEFAULT_SITE);
    expect(await loadSite(fakeStore({ title: 42 }))).toEqual(DEFAULT_SITE);
  });

  it('prefers the configured site address over the last admin origin', () => {
    const site = { ...DEFAULT_SITE, lastOrigin: 'https://seen.example' };
    expect(siteUrl({ siteUrl: 'https://set.example' }, site)).toBe('https://set.example');
    expect(siteUrl({ siteUrl: null }, site)).toBe('https://seen.example');
    expect(siteUrl({ siteUrl: null }, DEFAULT_SITE)).toBeNull();
  });
});
