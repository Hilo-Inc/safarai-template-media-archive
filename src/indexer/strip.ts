import { copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { MediaError } from './errors';
import { run } from './exec';
import type { AvOutput, AvProbe } from './probe';

/** Tags that must not survive stripping (matched on the tag name; XMP and IPTC are refused in any form). */
const FORBIDDEN_TAG = /^(GPS.*|Make|Model|.*Serial.*|Owner.*|Artist|Copyright|Software|UserComment|ImageDescription)$/i;

async function assertClean(file: string): Promise<void> {
  const { stdout } = await run('exiftool', ['-j', '-G', '--', file]);
  const tags = (JSON.parse(stdout)[0] ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(tags)) {
    const [group = '', name = ''] = key.split(':');
    if (group === 'ICC_Profile' || group === 'ExifTool' || group === 'File' || group === 'SourceFile') continue;
    if (/^(XMP|IPTC)/i.test(group) || FORBIDDEN_TAG.test(name)) {
      throw new MediaError(`Metadata could not be removed from this image (${key})`);
    }
  }
}

/**
 * Removes every tag (GPS, camera, dates, comments, XMP, IPTC) and writes back only Orientation and the ICC profile,
 * then checks the result. TIFF cannot be edited that way by exiftool (it keeps IFD0), so it is re-encoded through sharp.
 * On any failure `dest` is removed: nothing unstripped is left behind.
 */
export async function stripImage(src: string, dest: string): Promise<void> {
  const from = resolve(src);
  const to = resolve(dest);
  try {
    const ft = await fileTypeFromFile(from);
    if (ft?.mime === 'image/tiff') {
      // .rotate() bakes the EXIF orientation into the pixels; sharp writes no other metadata except the ICC profile. LZW is lossless, so the original stays an original.
      await sharp(from).rotate().keepIccProfile().tiff({ compression: 'lzw' }).toFile(to);
    } else {
      await copyFile(from, to);
      await run('exiftool', ['-q', '-overwrite_original', '-all=', '-tagsfromfile', '@', '-Orientation', '-ICC_Profile', '--', to]);
    }
    await assertClean(to);
  } catch (error) {
    await rm(to, { force: true });
    throw error instanceof MediaError ? error : new MediaError('The image could not be stripped of its metadata');
  }
}

/**
 * Stream copy into `dest` (its extension picks the container) with container, stream and chapter metadata removed.
 * `-c copy` keeps the display matrix, so a rotated phone video stays upright. On failure `dest` is removed.
 */
export async function stripAv(src: string, dest: string, probe: AvProbe, out: AvOutput): Promise<void> {
  const to = resolve(dest);
  const args = ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-i', resolve(src)];
  args.push(...(probe.hasVideo ? ['-map', '0:v:0', '-map', '0:a:0?'] : ['-map', '0:a:0']));
  args.push('-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1', '-map_chapters', '-1', '-c', 'copy');
  if (probe.videoCodec === 'hevc' && out.ext === 'mp4') args.push('-tag:v', 'hvc1');
  if (out.faststart) args.push('-movflags', '+faststart');
  try {
    await run('ffmpeg', [...args, to]);
  } catch (error) {
    await rm(to, { force: true });
    throw error;
  }
}
