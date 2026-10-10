import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE } from '../schema/site';
import { loadSite } from './site';
import type { Store } from './store';

const fakeStore = (value: unknown) => ({ getJson: async () => value }) as unknown as Store;

describe('site', () => {
  it('loads the saved site, or defaults when missing or invalid', async () => {
    expect(await loadSite(fakeStore({ ...DEFAULT_SITE, title: 'Mine' }))).toMatchObject({ title: 'Mine' });
    expect(await loadSite(fakeStore(null))).toEqual(DEFAULT_SITE);
    expect(await loadSite(fakeStore({ title: 42 }))).toEqual(DEFAULT_SITE);
  });

  it('still reads old files that recorded lastOrigin', async () => {
    const old = await loadSite(fakeStore({ ...DEFAULT_SITE, title: 'Old', lastOrigin: 'https://seen.example' }));
    expect(old.title).toBe('Old');
    expect(old).not.toHaveProperty('lastOrigin');
  });
});
