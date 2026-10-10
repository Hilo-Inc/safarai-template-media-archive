import { DEFAULT_SITE, siteSchema, type Site } from '../schema/site';
import { keys } from './keys';
import type { Store } from './store';

export const PRIVATE_JSON = 'private, no-store';

export async function loadSite(store: Store): Promise<Site> {
  const parsed = siteSchema.safeParse((await store.getJson(keys.site)) ?? {});
  return parsed.success ? parsed.data : DEFAULT_SITE;
}

export async function saveSite(store: Store, site: Site): Promise<void> {
  await store.putJson(keys.site, siteSchema.parse(site), PRIVATE_JSON);
}
