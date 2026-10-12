// Imports the synthetic Instagram export end to end against the S3 mock, with real processing.
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../src/config/load';
import { instagramImporter } from '../../src/importers/instagram';
import type { Listing } from '../../src/importers/types';
import { run } from '../../src/indexer/exec';
import { readManifest } from '../../src/indexer/import-files';
import { processItem } from '../../src/indexer/process-item';
import { runImport } from '../../src/indexer/run-import';
import { readStatus, writeStatus } from '../../src/indexer/status';
import { keys } from '../../src/lib/keys';
import { loadSite } from '../../src/lib/site';
import type { Store } from '../../src/lib/store';
import type { Post } from '../../src/schema/post';
import { createImport } from '../../src/server/imports';
import { INSTAGRAM_MEDIA, instagramJson, writeInstagramMedia } from '../fixtures/instagram';
import { testStore } from '../helpers/s3';

const config = resolveConfig({ preset: 'instagram' }, {});
let dir: string;
let workRoot: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ig-'));
  workRoot = await mkdtemp(join(tmpdir(), 'ig-work-'));
  await writeInstagramMedia(dir);
}, 120_000);
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(workRoot, { recursive: true, force: true });
});

const exif = async (file: string) => JSON.parse((await run('exiftool', ['-j', '-n', file])).stdout)[0] as Record<string, unknown>;
const ffTags = async (file: string) => {
  const out = JSON.parse((await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])).stdout);
  return JSON.stringify([out.format.tags ?? {}, ...out.streams.map((s: { tags?: object }) => s.tags ?? {})]);
};

/** What the browser does: drop every file, let the importer select, have the server admit that, upload what it returned, start. */
async function upload(s: Store, json: Record<string, string>): Promise<string> {
  const bodies = new Map<string, Uint8Array>();
  for (const [p, t] of Object.entries(json)) bodies.set(p, new TextEncoder().encode(t));
  for (const p of Object.keys(INSTAGRAM_MEDIA)) bodies.set(p, await readFile(join(dir, p)));
  const listing: Listing = {
    entries: [...bodies].map(([path, b]) => ({ path, size: b.length, lastModified: null })),
    readText: async (p) => new TextDecoder().decode(bodies.get(p)),
  };
  const selection = await instagramImporter.select(listing, config.kinds);
  if (!selection.ok) throw new Error(selection.reason);
  const res = await createImport(s, { importer: 'instagram', entries: selection.files });
  expect(res.status).toBe(201);
  const { id, files } = (await res.json()) as { id: string; files: { path: string }[] };
  for (const f of files) await s.put(keys.importPrefix(id) + f.path, bodies.get(f.path)!, 'application/octet-stream');
  const status = (await readStatus(s, id))!;
  await writeStatus(s, { ...status, state: 'queued' });
  return id;
}

const deps = (s: Store, extra: Partial<Parameters<typeof runImport>[1]> = {}) => ({ store: s, config, workRoot, build: async () => {}, ...extra });
const postOf = async (s: Store, id: string) => (await s.getJson<Post>(keys.post(id)))!;
const prefixLeft = async (s: Store, id: string) => (await s.list(keys.importPrefix(id))).map((o) => o.key.slice(keys.importPrefix(id).length)).sort();

/** Words of every private folder of the export, plus the draft, archived, deleted and unreferenced media. */
const FORBIDDEN = ['messages', 'inbox', 'personal_information', 'connections', 'login', 'ads', 'igtv', 'archived', 'deleted', 'draft', 'unreferenced'];

describe('Instagram export, end to end', () => {
  it('imports posts, reels and stories, and nothing private', async () => {
    const s = testStore('ig-e2e');
    const id = await upload(s, instagramJson({ malformed: false }));
    const status = await runImport(id, deps(s));

    expect(status).toMatchObject({ state: 'done', posts: { failed: 0 }, error: null });
    expect(await postOf(s, 'instagram_c1')).toMatchObject({ kind: 'post', media: [{ type: 'image' }, { type: 'image' }, { type: 'video' }] });
    for (const p of ['instagram_single', 'instagram_clip']) expect(await postOf(s, p)).toMatchObject({ kind: 'post' });
    const reel = await postOf(s, 'instagram_reel');
    expect(reel).toMatchObject({ kind: 'reel', music: { genre: 'Pop' } });
    expect((reel.media[0] as { subtitles?: unknown[] }).subtitles).toHaveLength(1);
    for (const n of [1, 2, 3, 4]) expect(await postOf(s, `instagram_s${n}`)).toMatchObject({ kind: 'story' });
    for (const p of ['archived', 'deleted', 'draft']) expect(await s.exists(keys.post(`instagram_${p}`))).toBe(false);

    // Privacy: every key in the bucket, and every stored JSON document.
    const all = (await s.list('')).map((o) => o.key);
    expect(all.length).toBeGreaterThan(10);
    for (const key of all) for (const word of FORBIDDEN) expect(key.toLowerCase(), key).not.toContain(word);
    expect(all.some((k) => k.endsWith('old.jpg'))).toBe(false);
    const jsonKeys = all.filter((k) => k.endsWith('.json'));
    expect(jsonKeys.filter((k) => k.startsWith('posts/')).length).toBe(8);
    for (const k of jsonKeys) {
      const text = (await s.getText(k))!;
      for (const secret of ['android-test-device', 'device_id', 'source_type', 'someone_1', 'profile_user', 'followers']) expect(text, k).not.toContain(secret);
      for (const gps of ['48.85', '43.67', '67.9481', '13.1322', 'latitude', 'GPSLatitude']) expect(text, k).not.toContain(gps);
      if (k.startsWith('posts/')) expect(JSON.parse(text).location ?? null, k).toBeNull();
    }
  });

  it('sets the avatar from the newest profile photo, as a metadata-free webp', async () => {
    const s = testStore('ig-e2e-avatar');
    await runImport(await upload(s, instagramJson({ malformed: false })), deps(s));
    const avatar = (await loadSite(s)).avatar;
    expect(avatar).toMatch(/^media\/site\/avatar-/);
    const local = join(workRoot, 'avatar.webp');
    await s.download(avatar!, local);
    const tags = await exif(local);
    expect(tags.FileType).toBe('WEBP');
    expect(Object.keys(tags).filter((k) => /^(GPS|Make$|Model$|DateTime|Software|Orientation)/.test(k))).toEqual([]);
    expect((await s.list('')).some((o) => o.key.endsWith('old.jpg'))).toBe(false);
  });

  it('strips GPS from published photos and videos', async () => {
    const s = testStore('ig-e2e-gps');
    await runImport(await upload(s, instagramJson({ malformed: false })), deps(s));
    const c1 = await postOf(s, 'instagram_c1');
    const reel = await postOf(s, 'instagram_reel');

    const img = join(workRoot, 'c1.jpg');
    await s.download(c1.media[0].src, img);
    expect(Object.keys(await exif(img)).filter((k) => k.startsWith('GPS'))).toEqual([]);

    // The fixture's source video carries a location atom; the published ones must not.
    const src = join(workRoot, 'reel-src.mp4');
    await copyFile(join(dir, 'media/other/reel.mp4'), src);
    expect(await ffTags(src)).toMatch(/location/i);
    for (const [name, key] of [['reel', reel.media[0].src], ['clip', c1.media[2].src]]) {
      const out = join(workRoot, `${name}.mp4`);
      await s.download(key, out);
      expect(await ffTags(out), name).not.toMatch(/location/i);
    }
  });

  it('empties imports/<id>/ after a clean import', async () => {
    const s = testStore('ig-e2e-clean');
    const id = await upload(s, instagramJson({ malformed: false }));
    expect(await prefixLeft(s, id)).not.toEqual([]);
    await runImport(id, deps(s));
    expect(await s.list(keys.importPrefix(id))).toEqual([]);
    expect(await s.exists(keys.importManifest(id))).toBe(false);
  });

  it('keeps only a failed item’s files, and the avatar source, for retry', async () => {
    const s = testStore('ig-e2e-fail');
    const id = await upload(s, instagramJson({ malformed: false }));
    const process: NonNullable<Parameters<typeof runImport>[1]['process']> = (input, st) =>
      input.postId === 'instagram_s2' ? Promise.resolve({ ok: false, reason: 'Broken file' }) : processItem(input, st);
    const status = await runImport(id, deps(s, { process }));

    expect(status).toMatchObject({ state: 'done', posts: { failed: 1 }, failures: [{ postId: 'instagram_s2' }] });
    const left = await prefixLeft(s, id);
    expect(left.filter((p) => p.startsWith('media/'))).toEqual(['media/other/new.jpg', 'media/stories/202401/s2.mp4']);
    expect(left.filter((p) => !p.startsWith('media/')).every((p) => p.endsWith('.json'))).toBe(true);
    // The manifest still lists every file and records the released ones.
    const manifest = (await readManifest(s, id))!;
    expect(manifest.released).toContain('media/posts/202401/c1.jpg');
    expect(manifest.released).not.toContain('media/stories/202401/s2.mp4');
  });

  it('accepts the old sample meta export', async () => {
    const s = testStore('ig-e2e-sample');
    const entry = (path: string) => ({ path, size: 10, lastModified: null });
    const res = await createImport(s, {
      entries: [entry('your_instagram_activity/messages/inbox/someone_1/message_1.json'), entry('your_instagram_activity/media/posts_1.json'), entry('media/posts/202401/1.jpg')],
    });
    expect(res.status).toBe(201);
    const { id, files } = (await res.json()) as { id: string; files: { path: string }[] };
    expect(files.map((f) => f.path).sort()).toEqual(['media/posts/202401/1.jpg', 'your_instagram_activity/media/posts_1.json']);
    expect(await readStatus(s, id)).toMatchObject({ importer: 'instagram' });
  });
});
