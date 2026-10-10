import type { ArchiveConfig } from '../config/schema';
import { isDeniedName, isDeniedPath, isJunkPath, isMetaExport, META_REFUSAL } from './guard';
import { baseName, extOf, hashtags, safePlatform, shortHash, slugId } from './text';
import type { Importer, Listing, ListingEntry, RawMedia, RawPost, Selection } from './types';

export const MEDIA_EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tif', 'tiff'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'],
};
const MEDIA = new Set([...MEDIA_EXTENSIONS.image, ...MEDIA_EXTENSIONS.video, ...MEDIA_EXTENSIONS.audio]);
const SUBTITLES = new Set(['srt', 'vtt']);

/** Media files, plus files with no extension (their type is detected from their bytes during processing). */
function isMediaCandidate(path: string): boolean {
  if (baseName(path) === '' || isDeniedName(path)) return false;
  const ext = extOf(path);
  return ext === '' ? !baseName(path).startsWith('.') : MEDIA.has(ext);
}

/** "dir/name.mp4" → "dir/name". Extensionless files are their own stem. */
function stemOf(path: string): string {
  const ext = extOf(path);
  return ext ? path.slice(0, -(ext.length + 1)) : path;
}

function sidecarsFor(media: string): string[] {
  return [`${stemOf(media)}.info.json`, `${media}.json`];
}

/** "dir/name.en.vtt" → { stem: "dir/name", lang: "en" }; "dir/name.srt" → { stem: "dir/name", lang: null }. */
function subtitleOf(path: string): { stem: string; lang: string | null } | null {
  const ext = extOf(path);
  if (!SUBTITLES.has(ext)) return null;
  const rest = path.slice(0, -(ext.length + 1));
  const m = /^(.*)\.([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?)$/.exec(rest);
  return m ? { stem: m[1]!, lang: m[2]!.toLowerCase() } : { stem: rest, lang: null };
}

function usable(entries: ListingEntry[]): ListingEntry[] {
  return entries.filter((e) => !isDeniedPath(e.path) && !isJunkPath(e.path));
}

async function select(listing: Listing): Promise<Selection> {
  if (isMetaExport(listing.entries.map((e) => e.path))) return { ok: false, reason: META_REFUSAL };
  const entries = usable(listing.entries);
  const media = entries.filter((e) => isMediaCandidate(e.path));
  if (media.length === 0) return { ok: false, reason: 'No photos, videos or audio files were found.' };
  const paths = new Set(entries.map((e) => e.path));
  const stems = new Set(media.map((e) => stemOf(e.path)));
  const wanted = new Set<string>();
  for (const m of media) for (const s of sidecarsFor(m.path)) if (paths.has(s)) wanted.add(s);
  for (const e of entries) {
    const sub = subtitleOf(e.path);
    if (sub && stems.has(sub.stem)) wanted.add(e.path);
  }
  const sidecars = entries.filter((e) => wanted.has(e.path));
  return { ok: true, files: [...media, ...sidecars], media: media.length, sidecars: sidecars.length };
}

type Json = Record<string, unknown>;

async function readJson(listing: Listing, path: string): Promise<Json | null> {
  try {
    const value: unknown = JSON.parse(await listing.readText(path));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function isoFromFields(info: Json): string | null {
  if (typeof info.timestamp === 'number' && Number.isFinite(info.timestamp)) return new Date(info.timestamp * 1000).toISOString();
  const day = str(info.upload_date);
  if (day && /^\d{8}$/.test(day)) return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00.000Z`;
  const date = str(info.date);
  if (date) {
    // gallery-dl writes "YYYY-MM-DD HH:MM:SS" in UTC.
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date) ? `${date.replace(' ', 'T')}Z` : date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function fileDate(entry: ListingEntry, now: string): string {
  return entry.lastModified !== null ? new Date(entry.lastModified).toISOString() : now;
}

function tagsOf(info: Json | null, caption: string): string[] {
  const own = Array.isArray(info?.tags) ? info.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase()) : [];
  return [...new Set([...own, ...hashtags(caption)])];
}

async function read(listing: Listing, config: ArchiveConfig): Promise<RawPost[]> {
  const entries = usable(listing.entries);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const media = entries.filter((e) => isMediaCandidate(e.path));
  const subtitles = new Map<string, { path: string; lang: string | null }[]>();
  for (const e of entries) {
    const sub = subtitleOf(e.path);
    if (!sub) continue;
    subtitles.set(sub.stem, [...(subtitles.get(sub.stem) ?? []), { path: e.path, lang: sub.lang }]);
  }
  const now = new Date().toISOString();
  const posts: RawPost[] = [];
  const galleries = new Map<string, { post: RawPost; items: { num: number; media: RawMedia }[] }>();
  const usedIds = new Set<string>();

  const uniqueId = async (platform: string, id: string, path: string) => {
    let out = id;
    if (usedIds.has(`${platform}_${out}`)) out = `${id.slice(0, 71)}-${await shortHash(path)}`;
    usedIds.add(`${platform}_${out}`);
    return out;
  };

  for (const entry of media) {
    const item: RawMedia = { path: entry.path };
    const subs = subtitles.get(stemOf(entry.path));
    if (subs?.length) item.subtitles = subs.sort((a, b) => a.path.localeCompare(b.path));

    const [ytPath, galleryPath] = sidecarsFor(entry.path) as [string, string];
    const yt = byPath.has(ytPath) ? await readJson(listing, ytPath) : null;
    const gallery = !yt && byPath.has(galleryPath) ? await readJson(listing, galleryPath) : null;
    const info = yt ?? gallery;
    const sourceId = info ? str(info.id) ?? str(info.shortcode) ?? str(info.post_id) ?? (typeof info.id === 'number' ? String(info.id) : null) : null;

    if (info && sourceId) {
      const platform = safePlatform(info.extractor_key ?? info.extractor ?? info.category);
      const caption = yt
        ? [str(info.title), str(info.description)].filter(Boolean).join('\n\n')
        : (str(info.description) ?? str(info.content) ?? str(info.caption) ?? '');
      const location = config.location !== 'none' && str(info.location) ? { name: str(info.location)! } : null;
      const base: RawPost = {
        platform,
        id: slugId(sourceId),
        published: isoFromFields(info) ?? fileDate(entry, now),
        caption,
        tags: tagsOf(info, caption),
        sourceUrl: str(info.webpage_url) ?? str(info.post_url) ?? null,
        location,
        music: str(info.genre) ? { genre: str(info.genre)! } : null,
        media: [],
      };
      if (gallery) {
        const key = `${platform}:${base.id}`;
        const group = galleries.get(key) ?? { post: base, items: [] };
        group.items.push({ num: typeof info.num === 'number' ? info.num : group.items.length + 1, media: item });
        if (!galleries.has(key)) {
          galleries.set(key, group);
          posts.push(base);
          usedIds.add(`${platform}_${base.id}`);
        }
        continue;
      }
      base.id = await uniqueId(platform, base.id, entry.path);
      base.media = [item];
      posts.push(base);
      continue;
    }

    const id = await uniqueId('files', slugId(baseName(stemOf(entry.path))), entry.path);
    posts.push({ platform: 'files', id, published: fileDate(entry, now), caption: '', tags: [], sourceUrl: null, location: null, music: null, media: [item] });
  }

  for (const { post, items } of galleries.values()) {
    post.media = items.sort((a, b) => a.num - b.num).map((i) => i.media);
  }
  return posts;
}

export const genericImporter: Importer = {
  name: 'generic',
  label: 'Photos, videos and audio (with yt-dlp or gallery-dl metadata if present)',
  detect: () => true,
  select,
  read,
};
