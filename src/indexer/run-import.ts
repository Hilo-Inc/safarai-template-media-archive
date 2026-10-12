import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchiveConfig, Kind } from '../config/schema';
import { getImporter } from '../importers/registry';
import { hashtags } from '../importers/text';
import type { ImportFiles, Importer, RawPost } from '../importers/types';
import { keys } from '../lib/keys';
import { loadSite } from '../lib/site';
import type { Store } from '../lib/store';
import { POST_ID_RE, postSchema, type MediaItem, type Post } from '../schema/post';
import { avatarWebp, storeAvatar } from '../server/site';
import { ImportError } from './errors';
import { inboxImportFiles, readManifest, uploadedImportFiles, writeManifest } from './import-files';
import { applyLocation } from './location';
import { readOverrides, serial, writePost } from './overrides';
import { processItem, type ItemResult } from './process-item';
import { addFailure, readStatus, writeStatus, type ImportStatus } from './status';

export interface RunDeps {
  store: Store;
  config: ArchiveConfig;
  /** A directory for temporary files; created if missing. */
  workRoot: string;
  now?: () => Date;
  process?: (input: Parameters<typeof processItem>[0], store: Store) => Promise<ItemResult>;
  build: () => Promise<unknown>;
}

const STATUS_EVERY = 25;
const GENERIC_ERROR = 'The import stopped unexpectedly';
const KIND_OF_TYPE: Record<MediaItem['type'], Kind> = { image: 'post', video: 'video', audio: 'track' };

/** Every bucket key a post points at (src, peaks, posters, variants, subtitles). */
export function mediaKeysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) mediaKeysOf(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'src' || k === 'peaks') && typeof v === 'string') out.add(v);
      else mediaKeysOf(v, out);
    }
  }
  return out;
}

/** Under the overrides lock, so an admin edit that already read the post cannot write it back after its media is gone. */
export function removePost(store: Store, postId: string): Promise<void> {
  return serial(async () => {
    await store.deleteKeys([keys.post(postId)]);
    await store.deletePrefix(keys.mediaPrefix(postId));
  });
}

/** Removes an upload for good: its objects, unfinished multipart uploads and the file list. */
async function discardUpload(store: Store, id: string): Promise<void> {
  await store.deletePrefix(keys.importPrefix(id));
  await store.abortUploads(keys.importPrefix(id));
  await store.deleteKeys([keys.importManifest(id)]);
}

/** The export's profile photo becomes the site avatar, unless the owner already chose one. A failure never fails the import. */
async function importAvatar(importer: Importer, listing: ImportFiles, deps: RunDeps): Promise<void> {
  let dir: string | null = null;
  try {
    const path = await importer.avatar!(listing);
    if (!path || (await loadSite(deps.store)).avatar) return;
    dir = await mkdtemp(join(deps.workRoot, 'avatar-'));
    const file = join(dir, 'src');
    await listing.download(path, file);
    await storeAvatar(deps.store, await avatarWebp(await readFile(file)));
  } catch {
    // No path or message: export paths can name the account.
    console.warn('The profile photo could not be used as the site picture');
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

export async function runImport(id: string, deps: RunDeps): Promise<ImportStatus | null> {
  const { store, config } = deps;
  const now = deps.now ?? (() => new Date());
  const process = deps.process ?? processItem;
  const status = await readStatus(store, id);
  if (!status || (status.state !== 'queued' && status.state !== 'running')) return status;

  status.state = 'running';
  status.startedAt ??= now().toISOString();
  status.finishedAt = null;
  status.error = null;
  status.failures = [];
  status.posts = { total: 0, done: status.doneIds.length, failed: 0, skipped: 0 };
  await writeStatus(store, status);

  try {
    let files: ImportFiles;
    if (status.source === 'upload') {
      const uploaded = await uploadedImportFiles(store, id);
      for (const m of uploaded.missing) addFailure(status, { postId: null, path: m.path, reason: 'This file did not finish uploading' });
      files = uploaded;
    } else {
      files = await inboxImportFiles(store);
    }

    const importer = getImporter(status.importer);
    if (!importer) throw new ImportError(`Unknown importer "${status.importer}"`);
    const selection = await importer.select(files, config.kinds);
    if (!selection.ok) {
      // Refused (for example a Meta export): nothing from it stays in the bucket.
      if (status.source === 'upload') await discardUpload(store, id);
      throw new ImportError(selection.reason);
    }
    const selected = new Set(selection.files.map((f) => f.path));
    const listing: ImportFiles = {
      entries: files.entries.filter((e) => selected.has(e.path)),
      readText: (path) => files.readText(path),
      download: (path, file) => files.download(path, file),
    };
    const raws = await importer.read(listing, config);
    status.posts.total = raws.length;

    // Unreadable overrides fail the import here, before any media work (writePost would refuse after files were processed).
    await readOverrides(store);
    await mkdir(deps.workRoot, { recursive: true });
    if (importer.avatar) await importAvatar(importer, listing, deps);
    const done = new Set(status.doneIds);
    // I5: an upload's files are deleted as soon as every post using them is finished, so storage peaks near the export's
    // size. A failed post keeps its files for "Retry failed items"; the JSON and the avatar source stay until the end.
    const pathsOf = (raw: RawPost) => [...new Set(raw.media.flatMap((m) => [m.path, ...(m.subtitles ?? []).map((s) => s.path)]))].filter((p) => selected.has(p));
    const refs = new Map<string, number>();
    if (status.source === 'upload') for (const raw of raws) for (const p of pathsOf(raw)) refs.set(p, (refs.get(p) ?? 0) + 1);
    const released: string[] = [];
    const release = async () => {
      if (released.length === 0) return;
      // The manifest keeps every entry, so the listing (and every importer's ids) is the same on a retry; it only records
      // which files are gone, so they are not reported as unfinished uploads. Recorded first: a crash in between leaves
      // stray objects (removed with the upload), never a file that is listed as present but gone.
      // Only posts that are not done are read again, and their files are never released.
      const gone = released.splice(0);
      const manifest = await readManifest(store, id);
      if (manifest) await writeManifest(store, { ...manifest, released: [...new Set([...(manifest.released ?? []), ...gone])] });
      await store.deleteKeys(gone.map((p) => keys.importPrefix(id) + p));
    };
    let handled = 0;
    for (const raw of raws) {
      const outcome = await importOne(raw, { ...deps, process, now }, listing, selected, status, done);
      if (outcome !== 'failed') {
        for (const p of pathsOf(raw)) {
          const left = (refs.get(p) ?? 0) - 1;
          refs.set(p, left);
          if (left === 0) released.push(p);
        }
      }
      if (++handled % STATUS_EVERY === 0) {
        // Status first: files are only deleted once their posts are recorded as done.
        await writeStatus(store, status);
        await release();
      }
    }
    await writeStatus(store, status);
    await release();

    await deps.build();

    if (status.posts.failed === 0) {
      if (status.source === 'upload') {
        await discardUpload(store, id);
      } else {
        await store.deleteKeys([...selected].map((p) => keys.inbox + p));
      }
    }
    status.state = 'done';
  } catch (error) {
    status.state = 'failed';
    // Only our own messages reach the owner; anything else (paths, bucket errors) stays in the server log.
    status.error = error instanceof ImportError ? error.message : GENERIC_ERROR;
    console.error(`Import ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  status.finishedAt = now().toISOString();
  await writeStatus(store, status);
  return status;
}

async function importOne(
  raw: RawPost,
  deps: RunDeps & Required<Pick<RunDeps, 'process' | 'now'>>,
  listing: ImportFiles,
  selected: Set<string>,
  status: ImportStatus,
  done: Set<string>,
): Promise<'done' | 'skipped' | 'failed'> {
  const { store, config } = deps;
  const postId = `${raw.platform}_${raw.id}`;
  if (!POST_ID_RE.test(postId) || postId.length > 120) {
    addFailure(status, { postId, path: raw.media[0]?.path ?? null, reason: "The export's details for this post are not valid" });
    return 'failed';
  }
  if (raw.state || (raw.kind && !config.kinds.includes(raw.kind))) {
    status.posts.skipped++;
    await removePost(store, postId);
    return 'skipped';
  }
  if (done.has(postId)) return 'done';
  if (raw.media.length === 0) {
    addFailure(status, { postId, path: null, reason: "The export's details for this post are not valid" });
    return 'failed';
  }

  const before = new Set((await store.list(keys.mediaPrefix(postId))).map((o) => o.key));
  const dir = await mkdtemp(join(deps.workRoot, 'post-'));
  let finished = false;
  try {
    const items: MediaItem[] = [];
    for (const [n, media] of raw.media.entries()) {
      if (!selected.has(media.path)) {
        addFailure(status, { postId, path: media.path, reason: 'A file referenced by the export is missing' });
        return 'failed';
      }
      const file = join(dir, `${n}-src`);
      await listing.download(media.path, file);
      const subtitles = [];
      for (const [i, sub] of (media.subtitles ?? []).filter((s) => selected.has(s.path)).entries()) {
        const subFile = join(dir, `${n}-sub-${i}`);
        await listing.download(sub.path, subFile);
        subtitles.push({ file: subFile, lang: sub.lang });
      }
      const result = await deps.process({ postId, n, file, alt: media.alt ?? null, subtitles, workDir: dir }, store);
      if (!result.ok) {
        addFailure(status, { postId, path: media.path, reason: result.reason });
        return 'failed';
      }
      items.push(result.item);
    }

    const kind = raw.kind ?? KIND_OF_TYPE[items[0]!.type];
    if (!config.kinds.includes(kind)) {
      status.posts.skipped++;
      await removePost(store, postId);
      finished = true;
      return 'skipped';
    }

    const parsed = postSchema.safeParse({
      schema: 1,
      id: postId,
      platform: raw.platform,
      kind,
      published: raw.published,
      importedAt: deps.now().toISOString(),
      caption: raw.caption,
      tags: raw.tags ?? hashtags(raw.caption),
      sourceUrl: raw.sourceUrl ?? null,
      location: applyLocation(raw.location, config.location),
      music: raw.music ?? null,
      hidden: false,
      featured: false,
      media: items,
    } satisfies Post);
    if (!parsed.success) {
      addFailure(status, { postId, path: raw.media[0]?.path ?? null, reason: "The export's details for this post are not valid" });
      return 'failed';
    }

    const used = mediaKeysOf(parsed.data);
    await writePost(store, parsed.data);
    // Only after the new post JSON is saved: until then the old one still points at its media.
    const unused = (await store.list(keys.mediaPrefix(postId))).map((o) => o.key).filter((k) => !used.has(k));
    await store.deleteKeys(unused);
    done.add(postId);
    status.doneIds.push(postId);
    status.posts.done++;
    finished = true;
    return 'done';
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (!finished) await discardPartialMedia(store, postId, before).catch(() => undefined);
  }
}

/** A post that did not finish: delete what this run uploaded for it, unless the saved post still points at it. */
async function discardPartialMedia(store: Store, postId: string, before: Set<string>): Promise<void> {
  let kept = new Set<string>();
  try {
    kept = mediaKeysOf(await store.getJson(keys.post(postId)));
  } catch {
    // An unreadable saved post references nothing we can trust; fall through and delete only what this run added.
  }
  const added = (await store.list(keys.mediaPrefix(postId))).map((o) => o.key).filter((k) => !before.has(k) && !kept.has(k));
  await store.deleteKeys(added);
}
