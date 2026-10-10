import { mkdtemp, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { keys } from '../lib/keys';
import { mapLimit } from '../lib/pool';
import type { Store } from '../lib/store';
import { mediaItemSchema, type MediaItem, type Poster } from '../schema/post';
import { audioPeaks, imageVariants, posterFrame, thumbhashOf, toVtt } from './derive';
import { MediaError } from './errors';
import { orientationOf } from './orientation';
import { avOutput, detectType, probeAv, probeImage, type Detected } from './probe';
import { stripAv, stripImage } from './strip';

export const DISK_MESSAGE = 'Not enough disk space on the server to process this file';

export interface ItemInput {
  postId: string;
  n: number;
  /** The downloaded upload. Its name and extension are not trusted. */
  file: string;
  alt: string | null;
  subtitles: { file: string; lang: string | null }[];
  /** A directory this call may write into; the caller removes it. */
  workDir: string;
}

export type ItemResult = { ok: true; item: MediaItem } | { ok: false; reason: string };

export interface ItemDeps {
  freeBytes(dir: string): Promise<number>;
}

export async function freeBytes(dir: string): Promise<number> {
  const s = await statfs(dir);
  return s.bavail * s.bsize;
}

interface Prepared {
  item: MediaItem;
  uploads: { name: string; file: string; type: string }[];
}

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export async function processItem(input: ItemInput, store: Store, deps: ItemDeps = { freeBytes }): Promise<ItemResult> {
  try {
    const { size } = await stat(input.file);
    if ((await deps.freeBytes(input.workDir)) < 2 * size) return { ok: false, reason: DISK_MESSAGE };
  } catch {
    return { ok: false, reason: 'The file could not be processed' };
  }
  const dir = await mkdtemp(join(input.workDir, `item-${input.n}-`));
  try {
    let prepared: Prepared;
    try {
      prepared = await prepare(input, dir);
    } catch (error) {
      return { ok: false, reason: error instanceof MediaError ? error.message : 'The file could not be processed' };
    }
    await mapLimit(prepared.uploads, 4, (u) => store.putFile(keys.media(input.postId, input.n, u.name), u.file, u.type));
    return { ok: true, item: prepared.item };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function prepare(input: ItemInput, dir: string): Promise<Prepared> {
  const detected = await detectType(input.file);
  const prepared = detected.type === 'image' ? await prepareImage(input, dir, detected) : await prepareAv(input, dir, detected);
  return { ...prepared, item: mediaItemSchema.parse(prepared.item) };
}

async function prepareImage(input: ItemInput, dir: string, detected: Detected): Promise<Prepared> {
  const key = (name: string) => keys.media(input.postId, input.n, name);
  const { width, height } = await probeImage(input.file);
  const origName = `orig.${detected.ext}`;
  const orig = join(dir, origName);
  await stripImage(input.file, orig);
  const variants = await imageVariants(orig, dir, width);
  return {
    item: {
      type: 'image',
      src: key(origName),
      width,
      height,
      orientation: orientationOf(width, height),
      alt: input.alt,
      thumbhash: await thumbhashOf(orig),
      variants: variants.map((v) => ({ w: v.w, src: key(v.name) })),
    },
    uploads: [{ name: origName, file: orig, type: detected.mime }, ...variants.map((v) => ({ name: v.name, file: v.file, type: 'image/webp' }))],
  };
}

async function prepareAv(input: ItemInput, dir: string, detected: Detected): Promise<Prepared> {
  const key = (name: string) => keys.media(input.postId, input.n, name);
  const probe = await probeAv(input.file);
  const out = avOutput(probe, detected);
  const origName = `orig.${out.ext}`;
  const orig = join(dir, origName);
  await stripAv(input.file, orig, probe, out);
  const uploads: Prepared['uploads'] = [{ name: origName, file: orig, type: out.mime }];

  if (!probe.hasVideo) {
    let peaks: string | null = null;
    try {
      const file = join(dir, 'peaks.json');
      await writeFile(file, JSON.stringify(await audioPeaks(orig, probe.duration)));
      uploads.push({ name: 'peaks.json', file, type: 'application/json' });
      peaks = key('peaks.json');
    } catch {
      // A waveform is optional; the player draws a flat line without it.
    }
    return { item: { type: 'audio', src: key(origName), duration: probe.duration, peaks }, uploads };
  }

  let poster: Poster | null = null;
  try {
    const p = await posterFrame(orig, dir, probe.duration);
    uploads.push({ name: 'poster.webp', file: p.file, type: 'image/webp' }, ...p.variants.map((v) => ({ name: v.name, file: v.file, type: 'image/webp' })));
    poster = { src: key('poster.webp'), width: p.width, height: p.height, variants: p.variants.map((v) => ({ w: v.w, src: key(v.name) })), thumbhash: p.thumbhash };
  } catch {
    // No poster: the page shows a placeholder at the video's size.
  }

  const subtitles: { src: string; lang: string | null }[] = [];
  const used = new Set<string>();
  for (const [i, sub] of input.subtitles.entries()) {
    const lang = sub.lang && LANG_RE.test(sub.lang) ? sub.lang : null;
    let name = lang ? `subs.${lang}.vtt` : i === 0 ? 'subs.vtt' : `subs.${i}.vtt`;
    if (used.has(name)) name = name.replace(/\.vtt$/, `-${i}.vtt`);
    try {
      const file = join(dir, name);
      await toVtt(sub.file, file);
      uploads.push({ name, file, type: 'text/vtt' });
      subtitles.push({ src: key(name), lang });
      used.add(name);
    } catch {
      // A broken subtitle file is left out; the video still imports.
    }
  }

  return {
    item: {
      type: 'video',
      src: key(origName),
      width: probe.width,
      height: probe.height,
      orientation: orientationOf(probe.width, probe.height),
      duration: probe.duration,
      playable: out.playable,
      poster,
      subtitles,
    },
    uploads,
  };
}
