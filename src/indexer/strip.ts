import { copyFile } from 'node:fs/promises';
import { run } from './exec';
import type { AvOutput, AvProbe } from './probe';

/** Lossless: removes every tag (GPS, camera, dates, comments) and writes back only Orientation and the ICC profile. */
export async function stripImage(src: string, dest: string): Promise<void> {
  await copyFile(src, dest);
  await run('exiftool', ['-q', '-overwrite_original', '-all=', '-tagsfromfile', '@', '-Orientation', '-ICC_Profile', dest]);
}

/**
 * Stream copy into `dest` (its extension picks the container) with container, stream and chapter
 * metadata removed. Rotation is written back explicitly so a portrait phone video stays upright.
 */
export async function stripAv(src: string, dest: string, probe: AvProbe, out: AvOutput): Promise<void> {
  const args = ['-v', 'error', '-y', '-i', src];
  args.push(...(probe.hasVideo ? ['-map', '0:v:0', '-map', '0:a:0?'] : ['-map', '0:a:0']));
  args.push('-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1', '-map_chapters', '-1', '-c', 'copy');
  if (probe.hasVideo && probe.rotation) args.push('-metadata:s:v:0', `rotate=${(360 - probe.rotation) % 360}`);
  if (probe.videoCodec === 'hevc' && out.ext === 'mp4') args.push('-tag:v', 'hvc1');
  if (out.faststart) args.push('-movflags', '+faststart');
  await run('ffmpeg', [...args, dest]);
}
