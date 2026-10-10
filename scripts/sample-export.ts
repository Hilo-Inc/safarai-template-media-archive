/**
 * Writes a generated sample export for hand checks. Nothing in it comes from a real account.
 * Usage: npm run sample-export -- <dir>
 */
import { mkdir, readdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { makeAudio, makeJpeg as makeTaggedJpeg, makeMp4, SRT } from '../test/helpers/media';

const out = process.argv[2];
if (!out) {
  console.error('Usage: npm run sample-export -- <dir>');
  process.exit(1);
}

/** The test helper tags the JPEG with exiftool; without exiftool installed, fall back to a plain generated JPEG. */
async function makeJpeg(file: string, opts: { width: number; height: number; orientation?: number; gps?: boolean }) {
  try {
    await makeTaggedJpeg(file, opts);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await sharp({ create: { width: opts.width, height: opts.height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .jpeg()
      .toFile(file);
  }
}

const folder = join(out, 'folder');
await rm(out, { recursive: true, force: true });
await mkdir(join(folder, 'photos'), { recursive: true });
await mkdir(join(folder, 'yt-dlp'), { recursive: true });
await mkdir(join(folder, 'gallery-dl', 'instagram', 'example'), { recursive: true });

// Plain photos: one post each, dated by file time. One has GPS, which must be stripped.
await makeJpeg(join(folder, 'photos', 'beach.jpg'), { width: 1600, height: 1200 });
await makeJpeg(join(folder, 'photos', 'portrait.jpg'), { width: 900, height: 1600, orientation: 6, gps: false });
await makeAudio(join(folder, 'photos', 'voice-note.mp3'), 4);

// yt-dlp: video + info.json + subtitles.
await makeMp4(join(folder, 'yt-dlp', 'Sample clip [abc123].mp4'), { width: 1280, height: 720, seconds: 3 });
await writeFile(
  join(folder, 'yt-dlp', 'Sample clip [abc123].info.json'),
  JSON.stringify({ id: 'abc123', title: 'Sample clip', description: 'A generated test clip #sample', timestamp: 1_700_000_000, extractor: 'youtube', tags: ['sample'] }),
);
await writeFile(join(folder, 'yt-dlp', 'Sample clip [abc123].en.srt'), SRT);

// gallery-dl: two images of one post, with per-file metadata.
const gdl = join(folder, 'gallery-dl', 'instagram', 'example');
for (const num of [1, 2]) {
  const name = `CsAmPlE0001_${num}.jpg`;
  await makeJpeg(join(gdl, name), { width: 1080, height: 1080, gps: false });
  await writeFile(
    join(gdl, `${name}.json`),
    JSON.stringify({ category: 'instagram', shortcode: 'CsAmPlE0001', num, date: '2024-05-01 12:00:00', description: 'Two generated squares #sample' }),
  );
}

// Not media: must be listed as staying on the computer.
await writeFile(join(folder, 'notes.txt'), 'This file is not uploaded.\n');

async function zipDir(dir: string, file: string): Promise<void> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) await walk(path);
      else await writer.add(relative(dir, path).split(sep).join('/'), new Uint8ArrayReader(await readFile(path)));
    }
  };
  await walk(dir);
  await writeFile(file, Buffer.from(await (await writer.close()).arrayBuffer()));
}
await zipDir(folder, join(out, 'sample-export.zip'));

// An Instagram-shaped export with a message thread: the generic importer must refuse all of it.
const meta = new ZipWriter(new BlobWriter('application/zip'));
await meta.add('your_instagram_activity/messages/inbox/someone_1/message_1.json', new TextReader('{"messages":[]}'));
await meta.add('your_instagram_activity/media/posts_1.json', new TextReader('[]'));
await meta.add('media/posts/202401/1.jpg', new Uint8ArrayReader(await readFile(join(folder, 'photos', 'beach.jpg'))));
await writeFile(join(out, 'meta-export.zip'), Buffer.from(await (await meta.close()).arrayBuffer()));

// A large file for stop/resume: a real MP4 head padded to 150 MB (it fails processing, which is fine for an upload test).
await makeMp4(join(out, 'big.mp4'), { width: 320, height: 240, seconds: 1 });
await truncate(join(out, 'big.mp4'), 150 * 1024 * 1024);

console.log(`Sample export written to ${out} (${(await stat(join(out, 'sample-export.zip'))).size} byte zip).`);
