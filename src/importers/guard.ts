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
  'profile',
  'followers_and_following',
  'login_and_account_creation',
  'account_information',
] as const;

const denied = new Set<string>(DENIED_SEGMENTS);

/** Splits on either separator after NFKC folding (so full-width look-alikes fold too); segments are trimmed and lowercased. */
function segmentsOf(path: string): string[] {
  return path
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .split(/[\\/]/)
    .map((s) => s.trim().toLowerCase());
}

/** A directory entry: the path ends in a separator (either kind). */
export function isDirectoryEntry(path: string): boolean {
  return segmentsOf(path).at(-1) === '';
}

/** Every folder segment (not the file name) is checked. */
export function isDeniedPath(path: string): boolean {
  return segmentsOf(path).slice(0, -1).some((s) => denied.has(s));
}

const DATA_EXTENSIONS = new Set(['json', 'html', 'htm', 'txt']);

/** True for a data file (no extension, or .json/.html/.htm/.txt) named like a denied folder. Media such as `profile.jpg` is not affected. */
export function isDeniedName(path: string): boolean {
  const name = segmentsOf(path).at(-1)!;
  const i = name.lastIndexOf('.');
  if (i <= 0) return denied.has(name);
  return DATA_EXTENSIONS.has(name.slice(i + 1)) && denied.has(name.slice(0, i));
}

const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export function isJunkPath(path: string): boolean {
  const segments = segmentsOf(path);
  const name = segments.at(-1)!;
  return segments.includes('__macosx') || name.startsWith('._') || JUNK_NAMES.has(name);
}

const META_MARKERS = [
  /(^|\/)your_instagram_activity\//,
  /(^|\/)your_facebook_activity\//,
  /(^|\/)content\/posts_\d+\.json$/,
  /(^|\/)messages\/inbox\//,
  /^([^/]+\/)?profile\.json$/,
  /^connections\//,
];

export function isMetaExport(paths: string[]): boolean {
  return paths.some((p) => META_MARKERS.some((re) => re.test(segmentsOf(p).join('/'))));
}

export const META_REFUSAL =
  'This looks like an Instagram or Facebook export. Its importer arrives in a later update; nothing was uploaded.';

export type MetaExportKind = 'instagram-json' | 'instagram-html' | 'facebook';

/** The Instagram JSON export's media lists, at the listing root or one folder below it (an unzipped part). */
const INSTAGRAM_JSON = /^(?:[^/]+\/)?your_instagram_activity\/media\/(?:posts_\d+|reels|stories)\.json$/;
const INSTAGRAM_HTML = /(^|\/)your_instagram_activity\/.*\.html?$/;
const FACEBOOK = /(^|\/)your_facebook_activity\//;

/** Which Meta export this is, if any. Facebook wins: its exports can carry Instagram folders too. */
export function metaExportKind(paths: string[]): MetaExportKind | null {
  const folded = paths.map((p) => segmentsOf(p).join('/'));
  if (folded.some((p) => FACEBOOK.test(p))) return 'facebook';
  if (folded.some((p) => INSTAGRAM_JSON.test(p))) return 'instagram-json';
  if (folded.some((p) => INSTAGRAM_HTML.test(p))) return 'instagram-html';
  return null;
}

export const INSTAGRAM_HTML_REFUSAL =
  'This is the HTML version of the Instagram export. Request it again with Format: JSON (Settings → Accounts Center → Your information and permissions → Export your information). Nothing was uploaded.';
