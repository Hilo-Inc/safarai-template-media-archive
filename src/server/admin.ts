import { MEDIA_EXTENSIONS } from '../importers/generic';
import type { ArchiveConfig } from '../config/schema';
import type { ServerEnv } from '../env';
import { keys } from '../lib/keys';
import { signJsonPaths } from '../lib/media-url';
import type { AdminIndex } from '../schema/index-types';
import type { PageDeps } from './pages';

/** What Hidden does and does not do. On a public archive the files stay in the public bucket, so say so. */
export const HIDDEN_NOTICE =
  'Hidden removes a post from your pages and feeds. On a public archive its files stay reachable by anyone who has or guesses their address; delete the post to remove them.';

export async function loadAdminPosts(deps: Pick<PageDeps, 'read' | 'sign'>): Promise<AdminIndex> {
  const index = await deps.read<AdminIndex>(keys.adminIndex);
  if (!index) return { built: '', posts: [] };
  return signJsonPaths(index, deps.sign);
}

export function feedNotice(config: Pick<ArchiveConfig, 'visibility'>, env: Pick<ServerEnv, 'siteUrl'>): string | null {
  if (config.visibility === 'password') return 'Feeds are off while the site needs a password.';
  if (env.siteUrl) return null;
  return "The RSS and JSON feeds need the site's address. Set SITE_URL in the deployment (Coolify sets COOLIFY_URL itself), then restart.";
}

/** The accepted file extensions per kind for the export guide, taken from the importer so the two cannot drift. */
export function mediaExtensionText(): Record<keyof typeof MEDIA_EXTENSIONS, string> {
  const text = (list: string[]) => list.map((e) => e.toUpperCase()).join(', ');
  return { image: text(MEDIA_EXTENSIONS.image), video: text(MEDIA_EXTENSIONS.video), audio: text(MEDIA_EXTENSIONS.audio) };
}
