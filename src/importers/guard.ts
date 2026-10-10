/** Folders whose files are never selected, uploaded, signed or read, at any depth. */
export const DENIED_SEGMENTS = [
  'messages',
  'inbox',
  'comments',
  'personal_information',
  'connections',
  'logged_information',
  'security_and_login_information',
  'ads_information',
  'ads_and_businesses',
  'preferences',
  'contacts',
] as const;

const denied = new Set<string>(DENIED_SEGMENTS);

/** Every folder segment (not the file name) is checked, case-insensitively. */
export function isDeniedPath(path: string): boolean {
  const segments = path.split('/');
  return segments.slice(0, -1).some((s) => denied.has(s.toLowerCase()));
}

const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export function isJunkPath(path: string): boolean {
  const segments = path.split('/');
  const name = segments.at(-1)!.toLowerCase();
  return segments.includes('__MACOSX') || name.startsWith('._') || JUNK_NAMES.has(name);
}

const META_MARKERS = [
  /(^|\/)your_instagram_activity\//,
  /(^|\/)your_facebook_activity\//,
  /(^|\/)content\/posts_\d+\.json$/,
  /(^|\/)messages\/inbox\//,
];

export function isMetaExport(paths: string[]): boolean {
  return paths.some((p) => META_MARKERS.some((re) => re.test(p.toLowerCase())));
}

export const META_REFUSAL =
  'This looks like an Instagram or Facebook export. Its importer arrives in a later update; nothing was uploaded.';
