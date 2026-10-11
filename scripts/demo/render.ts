// Renders the demo catalog to files: JPEG scenes (sharp), gradient clips and a short track (ffmpeg), and a
// gallery-dl style sidecar per file, which the generic importer turns into captions, dates, places and carousels.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { DemoMedia, DemoPost, Ratio } from './catalog';
import { PALETTES, sceneSvg } from './scene';

const run = promisify(execFile);
const SIZES: Record<Ratio, [number, number]> = { '1:1': [1200, 1200], '4:5': [1200, 1500], '16:9': [1600, 900], '9:16': [900, 1600] };
const VIDEO_SIZES = { '9:16': [720, 1280], '16:9': [1280, 720] } as const;
const EXT = { image: 'jpg', video: 'mp4', audio: 'mp3' } as const;
const hex = (color: string) => `0x${color.slice(1)}`;

/** Writes one post's media and sidecars into `dir`; returns the file names written. */
export async function renderPost(post: DemoPost, dir: string): Promise<string[]> {
  const names: string[] = [];
  for (const [i, media] of post.media.entries()) {
    const name = `${post.shortcode}_${i + 1}.${EXT[media.type]}`;
    await renderMedia(media, join(dir, name));
    const sidecar = {
      category: 'demo',
      shortcode: post.shortcode,
      num: i + 1,
      date: post.date,
      description: post.caption,
      ...(post.place ? { location: post.place } : {}),
    };
    await writeFile(join(dir, `${name}.json`), JSON.stringify(sidecar, null, 2));
    names.push(name, `${name}.json`);
  }
  return names;
}

async function renderMedia(media: DemoMedia, file: string): Promise<void> {
  if (media.type === 'image') {
    const [width, height] = SIZES[media.ratio];
    await sharp(Buffer.from(sceneSvg({ ...media, width, height }))).jpeg({ quality: 86 }).toFile(file);
    return;
  }
  if (media.type === 'video') {
    const [w, h] = VIDEO_SIZES[media.ratio];
    const p = PALETTES[media.mood];
    const s = media.seconds;
    await run('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:r=25:d=${s}:n=3:c0=${hex(p.sky[0])}:c1=${hex(p.sky[1])}:c2=${hex(p.near)}:speed=0.015:seed=${media.seed}`,
      '-f', 'lavfi', '-i', `sine=frequency=196:duration=${s},volume=0.06`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart',
      file,
    ]);
    return;
  }
  const s = media.seconds;
  // Three plucked notes repeating each second; "\\," escapes the commas inside the filtergraph expression.
  const pluck = (freq: number, amp: number, period: number) => `${amp}*sin(2*PI*${freq}*t)*exp(-1.5*mod(t\\,${period}))`;
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `aevalsrc=${pluck(220, 0.2, 1)}+${pluck(330, 0.12, 1)}+${pluck(440, 0.08, 2)}:s=44100:d=${s}`,
    '-af', `afade=t=out:st=${s - 2}:d=2`,
    '-c:a', 'libmp3lame', '-q:a', '4',
    file,
  ]);
}

/** The demo profile picture: a dusk mountain scene. */
export function avatarPng(): Promise<Buffer> {
  return sharp(Buffer.from(sceneSvg({ mood: 'dusk', scene: 'peaks', seed: 7, width: 512, height: 512 }))).png().toBuffer();
}
