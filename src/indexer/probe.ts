import { resolve } from 'node:path';
import { fileTypeFromFile } from 'file-type';
import sharp, { type Metadata } from 'sharp';
import { MediaError } from './errors';
import { run } from './exec';

export type Detected = { type: 'image' | 'av'; ext: string; mime: string };

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff']);
const AV_EXTRA = new Set(['asf']);

export async function detectType(file: string): Promise<Detected> {
  const ft = await fileTypeFromFile(file);
  if (!ft) throw new MediaError('Unrecognised file type');
  if (ft.mime.startsWith('image/')) {
    if (!IMAGE_MIMES.has(ft.mime)) throw new MediaError(`Unsupported image type: ${ft.mime}`);
    return { type: 'image', ext: ft.ext === 'jpg' ? 'jpg' : ft.ext, mime: ft.mime };
  }
  if (ft.mime.startsWith('video/') || ft.mime.startsWith('audio/') || AV_EXTRA.has(ft.ext)) {
    return { type: 'av', ext: ft.ext, mime: ft.mime };
  }
  throw new MediaError(`Not a photo, video or audio file (${ft.mime})`);
}

/** Display size: EXIF orientations 5–8 rotate by 90°, so width and height swap. */
export async function probeImage(file: string): Promise<{ width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(file).metadata();
  } catch {
    throw new MediaError('The image could not be read');
  }
  if (!meta.width || !meta.height) throw new MediaError('The image has no size');
  return (meta.orientation ?? 1) >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

export interface AvProbe {
  hasVideo: boolean;
  width: number;
  height: number;
  duration: number;
  rotation: 0 | 90 | 180 | 270;
  videoCodec: string | null;
  audioCodec: string | null;
}

interface FfStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

export function parseFfprobe(json: unknown): AvProbe {
  const out = (json && typeof json === 'object' ? json : {}) as { streams?: FfStream[]; format?: { duration?: string } };
  const streams = Array.isArray(out.streams) ? out.streams : [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  if (!v && !a) throw new MediaError('No audio or video in this file');
  const parsed = Number(v?.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? v?.tags?.rotate ?? 0);
  const raw = Number.isFinite(parsed) ? parsed : 0;
  const rotation = ((((Math.round(raw / 90) * 90) % 360) + 360) % 360) as AvProbe['rotation'];
  const swap = rotation === 90 || rotation === 270;
  const w = v?.width ?? 0;
  const h = v?.height ?? 0;
  const duration = Number(out.format?.duration) || Number(v?.duration) || 0;
  return {
    hasVideo: Boolean(v),
    width: swap ? h : w,
    height: swap ? w : h,
    duration,
    rotation,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
  };
}

export async function probeAv(file: string): Promise<AvProbe> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', '--', resolve(file)]);
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new MediaError('ffprobe could not read this file');
  }
  const probe = parseFfprobe(json);
  if (probe.hasVideo && (!probe.width || !probe.height)) throw new MediaError('The video has no size');
  return probe;
}

export interface AvOutput {
  ext: string;
  mime: string;
  playable: boolean;
  faststart: boolean;
}

const MP4_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9']);
const MP4_AUDIO = new Set(['aac', 'mp3', 'opus']);
const WEBM_VIDEO = new Set(['vp8', 'vp9', 'av1']);
const WEBM_AUDIO = new Set(['opus', 'vorbis']);
const FASTSTART = new Set(['mp4', 'm4a', 'mov']);

/** No transcoding: browser-playable streams are remuxed into a container browsers play; anything else is kept as it is. */
export function avOutput(p: AvProbe, detected: Detected): AvOutput {
  const a = p.audioCodec;
  const keep = (): AvOutput => ({ ext: detected.ext, mime: detected.mime, playable: false, faststart: FASTSTART.has(detected.ext) });
  if (p.hasVideo) {
    const v = p.videoCodec ?? '';
    if (detected.ext === 'webm' && WEBM_VIDEO.has(v) && (!a || WEBM_AUDIO.has(a))) {
      return { ext: 'webm', mime: 'video/webm', playable: true, faststart: false };
    }
    if (MP4_VIDEO.has(v) && (!a || MP4_AUDIO.has(a))) return { ext: 'mp4', mime: 'video/mp4', playable: true, faststart: true };
    return keep();
  }
  if (a === 'mp3') return { ext: 'mp3', mime: 'audio/mpeg', playable: true, faststart: false };
  if (a === 'aac') return { ext: 'm4a', mime: 'audio/mp4', playable: true, faststart: true };
  if (a === 'opus' || a === 'vorbis') return { ext: 'ogg', mime: 'audio/ogg', playable: true, faststart: false };
  if (a === 'flac') return { ext: 'flac', mime: 'audio/flac', playable: true, faststart: false };
  if (a?.startsWith('pcm_') && detected.ext === 'wav') return { ext: 'wav', mime: 'audio/wav', playable: true, faststart: false };
  return keep();
}
