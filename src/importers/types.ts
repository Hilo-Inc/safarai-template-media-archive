import type { ArchiveConfig, Kind } from '../config/schema';

export interface ListingEntry {
  /** Normalised relative path: forward slashes, no leading slash, no `.`/`..` segments. */
  path: string;
  size: number;
  lastModified: number | null;
}

export interface Listing {
  entries: ListingEntry[];
  /** Reads a small text file (sidecar JSON, subtitles). */
  readText(path: string): Promise<string>;
}

export type Selection =
  | {
      ok: true;
      files: ListingEntry[];
      media: number;
      sidecars: number;
      /** Referenced media found in no dropped part (Instagram). */
      missing?: number;
    }
  | { ok: false; reason: string };

export interface ImportFiles extends Listing {
  download(path: string, file: string): Promise<void>;
}

export interface RawMedia {
  path: string;
  alt?: string | null;
  subtitles?: { path: string; lang: string | null }[];
}

export interface RawPost {
  platform: string;
  id: string;
  /** Optional for generic posts: the runner uses the first item's type (image → post, video → video, audio → track). */
  kind?: Kind;
  /** Posts in these states are never published. */
  state?: 'archived' | 'deleted' | 'draft';
  published: string;
  caption: string;
  tags?: string[];
  sourceUrl?: string | null;
  location?: null | { name: string } | { lat: number; lng: number; name?: string };
  music?: { genre: string } | null;
  media: RawMedia[];
}

export interface Importer {
  name: string;
  label: string;
  detect(listing: Listing): boolean;
  /** Server side, before upload: the files it accepts, from paths alone. Without it the server calls `select`. */
  admit?(entries: ListingEntry[]): Selection;
  /** The files to upload. `kinds` (the site's configured kinds) lets an importer leave out kinds the site never shows. */
  select(listing: Listing, kinds?: readonly Kind[]): Promise<Selection>;
  read(files: Listing, config: ArchiveConfig): Promise<RawPost[]>;
  /** Path of a picture for the site avatar, when the export has one. */
  avatar?(files: Listing): Promise<string | null>;
}
