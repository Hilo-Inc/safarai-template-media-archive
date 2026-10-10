import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchiveConfig, Kind } from '../config/schema';
import { getImporter } from '../importers/registry';
import { hashtags } from '../importers/text';
import type { ImportFiles, RawPost } from '../importers/types';
import { keys } from '../lib/keys';
import type { Store } from '../lib/store';
import { POST_ID_RE, postSchema, type MediaItem, type Post } from '../schema/post';
import { ImportError } from './errors';
import { inboxImportFiles, uploadedImportFiles } from './import-files';
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
    const selection = await importer.select(files);
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
    const done = new Set(status.doneIds);
    let handled = 0;
    for (const raw of raws) {
      await importOne(raw, { ...deps, process, now }, listing, selected, status, done);
      if (++handled % STATUS_EVERY === 0) await writeStatus(store, status);
    }

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
): Promise<void> {
  const { store, config } = deps;
  const postId = `${raw.platform}_${raw.id}`;
  if (!POST_ID_RE.test(postId) || postId.length > 120) {
    addFailure(status, { postId, path: raw.media[0]?.path ?? null, reason: "The export's details for this post are not valid" });
    return;
  }
  if (raw.state || (raw.kind && !config.kinds.includes(raw.kind))) {
    status.posts.skipped++;
    await removePost(store, postId);
    return;
  }
  if (done.has(postId)) return;
  if (raw.media.length === 0) {
    addFailure(status, { postId, path: null, reason: "The export's details for this post are not valid" });
    return;
  }

  const before = new Set((await store.list(keys.mediaPrefix(postId))).map((o) => o.key));
  const dir = await mkdtemp(join(deps.workRoot, 'post-'));
  let finished = false;
  try {
    const items: MediaItem[] = [];
    for (const [n, media] of raw.media.entries()) {
      if (!selected.has(media.path)) {
        addFailure(status, { postId, path: media.path, reason: 'A file referenced by the export is missing' });
        return;
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
        return;
      }
      items.push(result.item);
    }

    const kind = raw.kind ?? KIND_OF_TYPE[items[0]!.type];
    if (!config.kinds.includes(kind)) {
      status.posts.skipped++;
      await removePost(store, postId);
      finished = true;
      return;
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
      return;
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
