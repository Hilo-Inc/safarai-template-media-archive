import type { ArchiveConfig, Kind } from '../config/schema';
import { isMediaCandidate } from './generic';
import { INSTAGRAM_HTML_REFUSAL, isDeniedPath, isJunkPath, META_REFUSAL, metaExportKind } from './guard';
import { exportJsonFiles, parseExport, resolver, uriStem, type IgCandidate, type ParsedExport } from './instagram-export';
import { extOf, hashtags, shortHash, slugId } from './text';
import type { Importer, Listing, ListingEntry, RawMedia, RawPost, Selection } from './types';

export const UNREADABLE_EXPORT = "The export's post list could not be read. Nothing was uploaded.";
const EPOCH = new Date(0).toISOString();

function refusal(paths: string[]): string | null {
  switch (metaExportKind(paths)) {
    case 'instagram-json':
      return null;
    case 'facebook':
      return META_REFUSAL;
    case 'instagram-html':
      return INSTAGRAM_HTML_REFUSAL;
    default:
      return 'This is not an Instagram export.';
  }
}

function stateOf(c: IgCandidate, p: ParsedExport): RawPost['state'] {
  if (c.uris.some((u) => p.archived.has(u))) return 'archived';
  if (c.uris.some((u) => p.deleted.has(u))) return 'deleted';
  if (c.uris.some((u) => p.drafts.has(u))) return 'draft';
  return undefined;
}

const publishable = (c: IgCandidate, p: ParsedExport, kinds?: readonly Kind[]) => !c.malformed && (!kinds || kinds.includes(c.kind)) && !stateOf(c, p);

function counted(files: ListingEntry[], missing?: number): Selection {
  const media = files.filter((f) => isMediaCandidate(f.path)).length;
  return { ok: true, files, media, sidecars: files.length - media, ...(missing === undefined ? {} : { missing }) };
}

/** Instagram only puts extensionless media under a `media` folder; elsewhere an extensionless file is not media. */
const mediaForAdmit = (path: string) => (extOf(path) === '' ? path.toLowerCase().split('/').slice(0, -1).includes('media') : isMediaCandidate(path));

function admit(entries: ListingEntry[]): Selection {
  const reason = refusal(entries.map((e) => e.path));
  if (reason) return { ok: false, reason };
  const json = new Set([...exportJsonFiles(entries).values()].map((e) => e.path));
  const keep = entries.filter(
    (e) => !isDeniedPath(e.path) && !isJunkPath(e.path) && (json.has(e.path) || mediaForAdmit(e.path) || ['srt', 'vtt'].includes(extOf(e.path))),
  );
  return counted(keep);
}

async function select(listing: Listing, kinds?: readonly Kind[]): Promise<Selection> {
  const parsed = await parseExport(listing);
  if (!parsed.candidates.some((c) => !c.malformed)) return { ok: false, reason: UNREADABLE_EXPORT };
  const find = resolver(listing.entries);
  const wanted = new Set(parsed.jsonFiles);
  const missing = new Set<string>();
  for (const c of parsed.candidates) {
    if (!publishable(c, parsed, kinds)) continue;
    for (const [i, uri] of c.uris.entries()) {
      const hit = find(uri);
      if (hit) wanted.add(hit.path);
      else missing.add(uri);
      const sub = c.subs[i] ? find(c.subs[i]!) : null;
      if (sub) wanted.add(sub.path);
    }
  }
  const avatar = parsed.avatar ? find(parsed.avatar) : null;
  if (avatar) wanted.add(avatar.path);
  return counted(listing.entries.filter((e) => wanted.has(e.path)), missing.size);
}

async function read(files: Listing, config: ArchiveConfig): Promise<RawPost[]> {
  const parsed = await parseExport(files);
  const find = resolver(files.entries);
  const used = new Set<string>();
  const posts: RawPost[] = [];
  for (const c of parsed.candidates) {
    if (c.malformed) {
      posts.push({ platform: 'instagram', id: `malformed-${c.kind}-${c.n}`, kind: c.kind, published: EPOCH, caption: '', media: [] });
      continue;
    }
    let id = slugId(uriStem(c.uris[0]!));
    if (used.has(id)) id = `${id.slice(0, 71)}-${await shortHash(c.uris[0]!)}`;
    used.add(id);

    const media: RawMedia[] = [];
    for (const [i, uri] of c.uris.entries()) {
      const hit = find(uri);
      if (!hit) continue;
      const sub = c.subs[i] ? find(c.subs[i]!) : null;
      media.push(sub ? { path: hit.path, subtitles: [{ path: sub.path, lang: null }] } : { path: hit.path });
    }
    const coords = c.uris.map((u) => parsed.locations.get(u)).find((l) => l !== undefined) ?? c.coords;
    const post: RawPost = {
      platform: 'instagram',
      id,
      kind: c.kind,
      published: c.published!,
      caption: c.caption,
      tags: hashtags(c.caption),
      sourceUrl: null,
      location: config.location !== 'none' && coords ? coords : null,
      music: c.music ? { genre: c.music } : null,
      // Nothing present: keep the first reference, which the runner reports as a missing file.
      media: media.length > 0 ? media : [{ path: c.uris[0]! }],
    };
    const state = stateOf(c, parsed);
    if (state) post.state = state;
    posts.push(post);
  }
  return posts;
}

async function avatar(files: Listing): Promise<string | null> {
  const { avatar: uri } = await parseExport(files);
  return uri ? (resolver(files.entries)(uri)?.path ?? null) : null;
}

export const instagramImporter: Importer = {
  name: 'instagram',
  label: 'Instagram export',
  detect: (listing) => metaExportKind(listing.entries.map((e) => e.path)) === 'instagram-json',
  admit,
  select,
  read,
  avatar,
};
