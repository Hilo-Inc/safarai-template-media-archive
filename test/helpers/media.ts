import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);

/** A JPEG with GPS EXIF and an EXIF Orientation tag. */
export async function makeJpeg(file: string, opts: { width: number; height: number; orientation?: number; gps?: boolean }) {
  await sharp({ create: { width: opts.width, height: opts.height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toFile(file);
  const args = ['-overwrite_original', `-Orientation=${opts.orientation ?? 1}`, '-n', '-Make=TestCam', '-Model=Test 1'];
  if (opts.gps !== false) args.push('-GPSLatitude=48.8566', '-GPSLatitudeRef=N', '-GPSLongitude=2.3522', '-GPSLongitudeRef=E');
  await run('exiftool', [...args, file]);
}

/** An H.264/AAC MP4 (or another codec) with location and title metadata, moov at the end. */
export async function makeMp4(
  file: string,
  opts: { width: number; height: number; seconds?: number; codec?: string; rotate?: number },
) {
  const s = opts.seconds ?? 2;
  const args = [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=${opts.width}x${opts.height}:rate=25:duration=${s}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${s}`,
    '-c:v', opts.codec ?? 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-metadata', 'location=+48.8566+002.3522/', '-metadata', 'title=private title',
  ];
  await run('ffmpeg', [...args, file]);
  // ffmpeg 5.1 ignores a `rotate` tag when muxing, so write the display matrix with exiftool (-Rotation).
  if (opts.rotate) await run('exiftool', ['-q', '-overwrite_original', `-Rotation=${opts.rotate}`, file]);
}

/** An MP3 or M4A tone with an artist tag. */
export async function makeAudio(file: string, seconds = 3) {
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-metadata', 'artist=private', file]);
}

export const SRT = '1\n00:00:00,000 --> 00:00:01,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nWorld\n';
