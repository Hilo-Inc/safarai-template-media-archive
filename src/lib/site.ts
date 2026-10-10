import type { ServerEnv } from '../env';
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

/** The site's own address for feed links: SITE_URL / COOLIFY_URL, else the origin of the last admin request. */
export function siteUrl(env: Pick<ServerEnv, 'siteUrl'>, site: Site): string | null {
  return env.siteUrl ?? site.lastOrigin;
}
