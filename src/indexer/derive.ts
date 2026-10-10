import { spawn } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve as absolute } from 'node:path';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { MediaError } from './errors';
import { run } from './exec';

export const VARIANT_WIDTHS = [320, 640, 1280, 2048] as const;
export const PEAK_COUNT = 1000;

export function variantWidths(width: number): number[] {
  const out: number[] = VARIANT_WIDTHS.filter((w) => w < width);
  if (width >= 2048) return [...VARIANT_WIDTHS];
  out.push(width);
  return out;
}

export async function imageVariants(file: string, outDir: string, width: number, prefix = 'w') {
  const out: { w: number; file: string; name: string }[] = [];
  for (const w of variantWidths(width)) {
    const name = `${prefix}${w}.webp`;
    const dest = join(outDir, name);
    await sharp(file, { animated: false }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(dest);
    out.push({ w, file: dest, name });
  }
  return out;
}

export async function thumbhashOf(file: string): Promise<string> {
  const { data, info } = await sharp(file, { animated: false })
    .rotate()
    .resize(100, 100, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
}

/** A frame at 1 s (or the first frame for short clips); ffmpeg applies rotation while decoding. */
export async function posterFrame(video: string, outDir: string, duration: number) {
  const tmp = await mkdtemp(join(tmpdir(), 'poster-'));
  try {
    const png = join(tmp, 'frame.png');
    const at = duration > 2 ? '1' : '0';
    await run('ffmpeg', ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-ss', at, '-i', absolute(video), '-frames:v', '1', png]);
    const file = join(outDir, 'poster.webp');
    const info = await sharp(png).webp({ quality: 80 }).toFile(file);
    return {
      file,
      width: info.width,
      height: info.height,
      variants: await imageVariants(png, outDir, info.width, 'poster-w'),
      thumbhash: await thumbhashOf(png),
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export function reducePeaks(values: number[], count = PEAK_COUNT): number[] {
  if (values.length === 0) return [];
  let buckets = values;
  if (values.length > count) {
    buckets = Array.from({ length: count }, (_, i) => {
      const start = Math.floor((i * values.length) / count);
      const end = Math.floor(((i + 1) * values.length) / count);
      let max = 0;
      for (let j = start; j < end; j++) max = Math.max(max, values[j]!);
      return max;
    });
  }
  const top = Math.max(...buckets);
  return buckets.map((v) => (top > 0 ? Math.round((v / top) * 1000) / 1000 : 0));
}

const PEAK_RATE = 8000;

/** Decodes to 8 kHz mono float samples on a pipe and keeps the loudest sample of each small block. */
export function audioPeaks(file: string, duration: number): Promise<number[]> {
  // With an unknown duration, assume blocks of 400 samples (20 per second) rather than one entry per sample.
  const block = duration > 0 && Number.isFinite(duration) ? Math.max(1, Math.floor((duration * PEAK_RATE) / (PEAK_COUNT * 4))) : 400;
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-protocol_whitelist', 'file', '-i', absolute(file), '-ac', '1', '-ar', String(PEAK_RATE), '-f', 'f32le', '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const blocks: number[] = [];
    let current = 0;
    let inBlock = 0;
    let rest: Buffer = Buffer.alloc(0);
    let stderr = '';
    ff.stdout.on('data', (chunk: Buffer) => {
      const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const usable = buf.length - (buf.length % 4);
      for (let i = 0; i < usable; i += 4) {
        current = Math.max(current, Math.abs(buf.readFloatLE(i)));
        if (++inBlock === block) {
          blocks.push(current);
          current = 0;
          inBlock = 0;
        }
      }
      rest = buf.subarray(usable);
    });
    ff.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    ff.on('error', () => reject(new MediaError('ffmpeg is not available')));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new MediaError(`ffmpeg could not decode the audio: ${stderr.trim().split('\n').at(-1)?.split(absolute(file)).join(basename(file)).slice(0, 200) ?? ''}`));
      if (inBlock) blocks.push(current);
      resolve(reducePeaks(blocks));
    });
  });
}

/** .srt or .vtt in, WebVTT out. The input format is forced: WebVTT if the file starts with the WEBVTT signature, otherwise SRT. */
export async function toVtt(src: string, dest: string): Promise<void> {
  const from = absolute(src);
  const fh = await open(from, 'r').catch(() => {
    throw new MediaError('The subtitle file could not be read');
  });
  const head = Buffer.alloc(8);
  try {
    await fh.read(head, 0, 8, 0);
  } finally {
    await fh.close();
  }
  const format = head.toString('utf8').replace(/^\uFEFF/, '').startsWith('WEBVTT') ? 'webvtt' : 'srt';
  await run('ffmpeg', ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-f', format, '-i', from, '-f', 'webvtt', absolute(dest)]);
}
