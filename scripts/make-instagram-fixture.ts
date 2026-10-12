/**
 * Writes sample-export/instagram-export.zip: the synthetic Instagram export from test/fixtures/instagram.ts with real
 * media. Needs exiftool and ffmpeg (run it in the test container: docker compose run --rm test npm run instagram-fixture).
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { instagramJson, INSTAGRAM_MEDIA, writeInstagramMedia } from '../test/fixtures/instagram';

const dir = await mkdtemp(join(tmpdir(), 'ig-fixture-'));
try {
  await writeInstagramMedia(dir);
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  for (const [path, text] of Object.entries(instagramJson())) await zip.add(path, new TextReader(text));
  for (const path of Object.keys(INSTAGRAM_MEDIA)) await zip.add(path, new Uint8ArrayReader(await readFile(join(dir, path))));
  await mkdir('sample-export', { recursive: true });
  await writeFile(join('sample-export', 'instagram-export.zip'), Buffer.from(await (await zip.close()).arrayBuffer()));
  console.log('Wrote sample-export/instagram-export.zip');
} finally {
  await rm(dir, { recursive: true, force: true });
}
