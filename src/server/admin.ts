import { MEDIA_EXTENSIONS } from '../importers/generic';
import type { ArchiveConfig } from '../config/schema';
import type { ServerEnv } from '../env';
import { siteUrl } from '../lib/site';
import { keys } from '../lib/keys';
import { signJsonPaths } from '../lib/media-url';
import type { AdminIndex } from '../schema/index-types';
import type { Site } from '../schema/site';
import type { PageDeps } from './pages';

export async function loadAdminPosts(deps: Pick<PageDeps, 'read' | 'sign'>): Promise<AdminIndex> {
  const index = await deps.read<AdminIndex>(keys.adminIndex);
  if (!index) return { built: '', posts: [] };
  return signJsonPaths(index, deps.sign);
}

export function feedNotice(config: Pick<ArchiveConfig, 'visibility'>, env: Pick<ServerEnv, 'siteUrl'>, site: Site): string | null {
  if (config.visibility === 'password') return 'Feeds are off while the site needs a password.';
  if (siteUrl(env, site)) return null;
  return "The RSS and JSON feeds need the site's address. Set SITE_URL in the deployment (Coolify sets COOLIFY_URL itself), then restart.";
}

/** The accepted file extensions per kind for the export guide, taken from the importer so the two cannot drift. */
export function mediaExtensionText(): Record<keyof typeof MEDIA_EXTENSIONS, string> {
  const text = (list: string[]) => list.map((e) => e.toUpperCase()).join(', ');
  return { image: text(MEDIA_EXTENSIONS.image), video: text(MEDIA_EXTENSIONS.video), audio: text(MEDIA_EXTENSIONS.audio) };
}
