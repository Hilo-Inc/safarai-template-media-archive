// The Instagram JSON export's media lists, parsed into candidates. Browser-safe: the import page runs it to choose
// what to upload, and the indexer runs it again on the uploaded files.
import { isMediaCandidate, MEDIA_EXTENSIONS } from './generic';
import { isDeniedPath, isJunkPath } from './guard';
import { fixMetaText } from './meta-text';
import { baseName, extOf } from './text';
import type { Listing, ListingEntry } from './types';

export type IgKind = 'post' | 'reel' | 'story';
type Coords = { lat: number; lng: number };

export interface IgCandidate {
  kind: IgKind;
  /** 0-based position among records of its kind, across files: names malformed records. */
  n: number;
  malformed: boolean;
  /** Safe uris of the record's media, in order. */
  uris: string[];
  /** Per uri: its subtitle file's uri, or null. */
  subs: (string | null)[];
  caption: string;
  /** ISO time, or null for a malformed record. */
  published: string | null;
  /** From exif_data on the record's items. */
  coords: Coords | null;
  music: string | null;
}

export interface ParsedExport {
  candidates: IgCandidate[];
  archived: Set<string>;
  deleted: Set<string>;
  drafts: Set<string>;
  /** posts.json coordinates by uri. */
  locations: Map<string, Coords>;
  /** Newest profile photo uri. */
  avatar: string | null;
  /** Listing paths of the JSON files read. */
  jsonFiles: string[];
  /** Names ("archived_posts", "posts_2", …) of listed JSON files that could not be read or parsed. */
  unreadable: string[];
}

const READ = /^(?:[^/]+\/)?your_instagram_activity\/media\/(posts_\d+|posts|reels|stories|profile_photos|archived_posts|recently_deleted_content)\.json$/;
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const byPath = (a: ListingEntry, b: ListingEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function safeUri(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const uri = value.trim();
  if (!uri || uri.startsWith('/') || uri.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(uri)) return null;
  if (uri.split('/').some((s) => s === '' || s === '.' || s === '..' || ['.', '..'].includes(s.normalize('NFKC').trim()))) return null;
  if (isDeniedPath(uri) || isJunkPath(uri)) return null;
  return uri;
}

/** uri → listing entry: the exact path, else a path one folder down (an unzipped part). Denied and junk entries never match. */
export function resolver(entries: ListingEntry[]): (uri: string) => ListingEntry | null {
  const exact = new Map<string, ListingEntry>();
  const nested = new Map<string, ListingEntry>();
  for (const e of [...entries].sort(byPath)) {
    if (isDeniedPath(e.path) || isJunkPath(e.path)) continue;
    exact.set(e.path, e);
    const i = e.path.indexOf('/');
    if (i > 0 && !nested.has(e.path.slice(i + 1))) nested.set(e.path.slice(i + 1), e);
  }
  return (uri) => exact.get(uri) ?? nested.get(uri) ?? null;
}

/** basename ("posts_1", "stories", …) → its file; the first path in sorted order wins. */
export function exportJsonFiles(entries: ListingEntry[]): Map<string, ListingEntry> {
  const out = new Map<string, ListingEntry>();
  for (const e of [...entries].sort(byPath)) {
    if (isDeniedPath(e.path) || isJunkPath(e.path)) continue;
    const m = READ.exec(e.path);
    if (m && !out.has(m[1]!)) out.set(m[1]!, e);
  }
  return out;
}

/** The parsed JSON, or null when the file is not listed. Throws when it is listed but cannot be read or parsed. */
async function readJson(listing: Listing, entry: ListingEntry | undefined): Promise<unknown> {
  return entry ? JSON.parse(await listing.readText(entry.path)) : null;
}

const text = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  const t = fixMetaText(v).trim();
  return t === 'Media' ? '' : t;
};

const seconds = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v * 1000 <= 8.64e15 ? v : null);
const iso = (s: number) => new Date(s * 1000).toISOString();

function coordsOf(lat: unknown, lng: unknown, parse = false): Coords | null {
  const num = (v: unknown) => (parse && typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
  const a = num(lat);
  const b = num(lng);
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

/** The first latitude/longitude pair in an item's exif_data. Only those two keys are read (never device_id). */
function exifCoords(item: unknown): Coords | null {
  if (!isObj(item) || !isObj(item.media_metadata)) return null;
  for (const k of ['photo_metadata', 'video_metadata']) {
    const meta = item.media_metadata[k];
    if (!isObj(meta) || !Array.isArray(meta.exif_data)) continue;
    for (const ex of meta.exif_data) {
      const c = isObj(ex) ? coordsOf(ex.latitude, ex.longitude) : null;
      if (c) return c;
    }
  }
  return null;
}

const mediaUri = (v: unknown): string | null => {
  const uri = safeUri(v);
  return uri && isMediaCandidate(uri) ? uri : null;
};

function malformed(kind: IgKind, n: number): IgCandidate {
  return { kind, n, malformed: true, uris: [], subs: [], caption: '', published: null, coords: null, music: null };
}

function postCandidate(entry: unknown, n: number): IgCandidate | null {
  if (!isObj(entry) || !Array.isArray(entry.media) || entry.media.length === 0) return malformed('post', n);
  const items = entry.media;
  const first = isObj(items[0]) ? items[0] : {};
  const ts = seconds(entry.creation_timestamp) ?? seconds(first.creation_timestamp);
  if (ts === null) return malformed('post', n);
  const kept = items.map((item) => ({ item, uri: isObj(item) ? mediaUri(item.uri) : null })).filter((x) => x.uri !== null);
  if (kept.length === 0) return null;
  return {
    kind: 'post',
    n,
    malformed: false,
    uris: kept.map((x) => x.uri!),
    subs: kept.map(() => null),
    caption: text(entry.title) || text(first.title),
    published: iso(ts),
    coords: kept.map((x) => exifCoords(x.item)).find((c) => c !== null) ?? null,
    music: null,
  };
}

function reelCandidate(item: unknown, n: number): IgCandidate | null {
  if (!isObj(item)) return malformed('reel', n);
  const ts = seconds(item.creation_timestamp);
  if (ts === null) return malformed('reel', n);
  const uri = mediaUri(item.uri);
  if (!uri) return null;
  const video = isObj(item.media_metadata) && isObj(item.media_metadata.video_metadata) ? item.media_metadata.video_metadata : {};
  const sub = isObj(video.subtitles) ? safeUri(video.subtitles.uri) : null;
  return {
    kind: 'reel',
    n,
    malformed: false,
    uris: [uri],
    subs: [sub && ['srt', 'vtt'].includes(extOf(sub)) ? sub : null],
    caption: text(item.title),
    published: iso(ts),
    coords: exifCoords(item),
    music: typeof video.music_genre === 'string' && video.music_genre.trim() ? fixMetaText(video.music_genre).trim() : null,
  };
}

function storyCandidate(item: unknown, n: number): IgCandidate | null {
  if (!isObj(item) || typeof item.uri !== 'string') return malformed('story', n);
  const ts = seconds(item.creation_timestamp);
  if (ts === null) return malformed('story', n);
  const uri = mediaUri(item.uri);
  if (!uri) return null;
  return { kind: 'story', n, malformed: false, uris: [uri], subs: [null], caption: text(item.title), published: iso(ts), coords: exifCoords(item), music: null };
}

/** Children of a JSON container, for the iterative walks below (no recursion: a hostile file can nest arbitrarily deep). */
const children = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : []);

/** Depth-first, document order, without recursion. */
function* walk(root: unknown): Generator<unknown> {
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    yield v;
    const kids = children(v);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

/** Every safe uri string at any depth. */
function urisIn(root: unknown): Set<string> {
  const out = new Set<string>();
  for (const v of walk(root)) {
    if (!isObj(v)) continue;
    const uri = safeUri(v.uri);
    if (uri) out.add(uri);
  }
  return out;
}

/** {label, value} string pairs at any depth; the first of a label wins. */
function labels(root: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of walk(root)) {
    if (isObj(v) && typeof v.label === 'string' && typeof v.value === 'string' && !out.has(v.label)) out.set(v.label, v.value);
  }
  return out;
}

/** Media objects under a "Media" label, at any depth. */
function labelledMedia(root: unknown): unknown[] {
  const out: unknown[] = [];
  // A loop, not push(...media): a huge array would overflow the call stack.
  for (const v of walk(root)) if (isObj(v) && v.label === 'Media' && Array.isArray(v.media)) for (const m of v.media) out.push(m);
  return out;
}

const records = (json: unknown): unknown[] => (Array.isArray(json) ? json : isObj(json) ? Object.values(json).filter(Array.isArray).flat() : []);
const listOf = (json: unknown, key: string): unknown[] => (isObj(json) && Array.isArray(json[key]) ? json[key] : []);
const postsNumber = (name: string) => Number(name.slice('posts_'.length));

export async function parseExport(listing: Listing): Promise<ParsedExport> {
  const files = exportJsonFiles(listing.entries);
  const unreadable: string[] = [];
  // A listed file that fails to read or parse is recorded (never silently treated as empty) and reads as absent.
  const get = async (name: string): Promise<unknown> => {
    try {
      return await readJson(listing, files.get(name));
    } catch {
      unreadable.push(name);
      return null;
    }
  };
  const candidates: IgCandidate[] = [];
  const counts: Record<IgKind, number> = { post: 0, reel: 0, story: 0 };
  const add = (c: IgCandidate | null) => {
    if (c) candidates.push(c);
  };

  const postFiles = [...files.keys()].filter((k) => /^posts_\d+$/.test(k)).sort((a, b) => postsNumber(a) - postsNumber(b));
  for (const name of postFiles) {
    const before = unreadable.length;
    const json = await get(name);
    // The owner sees an unreadable posts file as a failed post, not as nothing.
    if (unreadable.length > before) add(malformed('post', counts.post++));
    else if (Array.isArray(json)) for (const entry of json) add(postCandidate(entry, counts.post++));
  }
  for (const group of listOf(await get('reels'), 'ig_reels_media')) {
    if (!isObj(group) || !Array.isArray(group.media)) add(malformed('reel', counts.reel++));
    else for (const item of group.media) add(reelCandidate(item, counts.reel++));
  }
  for (const item of listOf(await get('stories'), 'ig_stories')) add(storyCandidate(item, counts.story++));

  const drafts = new Set<string>();
  const locations = new Map<string, Coords>();
  for (const record of records(await get('posts'))) {
    const pairs = labels(record);
    const media = labelledMedia(record);
    const uris = media.map((m) => (isObj(m) ? safeUri(m.uri) : null)).filter((u): u is string => u !== null);
    if (pairs.get('Published') === 'False' || pairs.get('Draft') === 'True') for (const u of uris) drafts.add(u);
    const at = coordsOf(pairs.get('Latitude'), pairs.get('Longitude'), true) ?? media.map(exifCoords).find((c) => c !== null) ?? null;
    if (at) for (const u of uris) if (!locations.has(u)) locations.set(u, at);
  }

  let avatar: string | null = null;
  let newest = -Infinity;
  for (const p of listOf(await get('profile_photos'), 'ig_profile_picture')) {
    if (!isObj(p)) continue;
    const uri = mediaUri(p.uri);
    const ext = uri ? extOf(uri) : '';
    const ts = seconds(p.creation_timestamp);
    if (uri && ts !== null && (ext === '' || MEDIA_EXTENSIONS.image.includes(ext)) && ts > newest) {
      avatar = uri;
      newest = ts;
    }
  }

  const archived = urisIn(await get('archived_posts'));
  const deleted = urisIn(await get('recently_deleted_content'));
  return { candidates, archived, deleted, drafts, locations, avatar, jsonFiles: [...files.values()].map((e) => e.path), unreadable };
}

/** "media/other/123.mp4" → "123". */
export function uriStem(uri: string): string {
  const name = baseName(uri);
  const ext = extOf(uri);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}
