import { describe, expect, it } from 'vitest';
import { avOutput, parseFfprobe, type AvProbe } from './probe';

const video = (codec: string, audio: string | null, extra: Record<string, unknown> = {}) => ({
  streams: [
    { codec_type: 'video', codec_name: codec, width: 1920, height: 1080, ...extra },
    ...(audio ? [{ codec_type: 'audio', codec_name: audio }] : []),
  ],
  format: { duration: '12.5' },
});

describe('parseFfprobe', () => {
  it('reads size, duration and codecs', () => {
    expect(parseFfprobe(video('h264', 'aac'))).toEqual({
      hasVideo: true, width: 1920, height: 1080, duration: 12.5, rotation: 0, videoCodec: 'h264', audioCodec: 'aac',
    });
  });

  it('swaps width and height for a rotated video', () => {
    const p = parseFfprobe(video('h264', 'aac', { side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] }));
    expect([p.width, p.height, p.rotation]).toEqual([1080, 1920, 270]);
    const q = parseFfprobe(video('h264', null, { tags: { rotate: '90' } }));
    expect([q.width, q.height, q.rotation]).toEqual([1080, 1920, 90]);
    const r = parseFfprobe(video('h264', null, { side_data_list: [{ rotation: 180 }] }));
    expect([r.width, r.height, r.rotation]).toEqual([1920, 1080, 180]);
  });

  it('treats a non-numeric rotate tag as no rotation', () => {
    const p = parseFfprobe(video('h264', null, { tags: { rotate: 'abc' } }));
    expect([p.width, p.height, p.rotation]).toEqual([1920, 1080, 0]);
  });

  it('treats cover art in an audio file as audio', () => {
    const p = parseFfprobe({
      streams: [
        { codec_type: 'audio', codec_name: 'mp3' },
        { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 } },
      ],
      format: { duration: '3.0' },
    });
    expect(p).toEqual({ hasVideo: false, width: 0, height: 0, duration: 3, rotation: 0, videoCodec: null, audioCodec: 'mp3' });
  });

  it('refuses files with no audio or video', () => {
    expect(() => parseFfprobe({ streams: [], format: {} })).toThrow('No audio or video in this file');
    expect(() => parseFfprobe('nonsense')).toThrow('No audio or video in this file');
  });
});

describe('avOutput', () => {
  const probe = (videoCodec: string | null, audioCodec: string | null): AvProbe => ({
    hasVideo: videoCodec !== null, width: 10, height: 10, duration: 1, rotation: 0, videoCodec, audioCodec,
  });
  const d = (ext: string, mime: string) => ({ type: 'av' as const, ext, mime });

  it.each([
    ['h264 + aac in mov → mp4', probe('h264', 'aac'), d('mov', 'video/quicktime'), { ext: 'mp4', mime: 'video/mp4', playable: true, faststart: true }],
    ['hevc alone in mp4 → mp4', probe('hevc', null), d('mp4', 'video/mp4'), { ext: 'mp4', mime: 'video/mp4', playable: true, faststart: true }],
    ['vp9 + opus in webm stays webm', probe('vp9', 'opus'), d('webm', 'video/webm'), { ext: 'webm', mime: 'video/webm', playable: true, faststart: false }],
    ['vp8 + vorbis in mkv is kept', probe('vp8', 'vorbis'), d('mkv', 'video/x-matroska'), { ext: 'mkv', mime: 'video/x-matroska', playable: false, faststart: false }],
    ['mpeg4 in avi is kept', probe('mpeg4', 'mp3'), d('avi', 'video/vnd.avi'), { ext: 'avi', mime: 'video/vnd.avi', playable: false, faststart: false }],
    ['h264 + pcm in mov is kept', probe('h264', 'pcm_s16le'), d('mov', 'video/quicktime'), { ext: 'mov', mime: 'video/quicktime', playable: false, faststart: true }],
    ['mp3 audio', probe(null, 'mp3'), d('mp3', 'audio/mpeg'), { ext: 'mp3', mime: 'audio/mpeg', playable: true, faststart: false }],
    ['aac in mp4 container → m4a', probe(null, 'aac'), d('mp4', 'video/mp4'), { ext: 'm4a', mime: 'audio/mp4', playable: true, faststart: true }],
    ['opus → ogg', probe(null, 'opus'), d('opus', 'audio/opus'), { ext: 'ogg', mime: 'audio/ogg', playable: true, faststart: false }],
    ['flac', probe(null, 'flac'), d('flac', 'audio/x-flac'), { ext: 'flac', mime: 'audio/flac', playable: true, faststart: false }],
    ['wav pcm', probe(null, 'pcm_s16le'), d('wav', 'audio/wav'), { ext: 'wav', mime: 'audio/wav', playable: true, faststart: false }],
    ['wma is kept', probe(null, 'wmav2'), d('asf', 'application/vnd.ms-asf'), { ext: 'asf', mime: 'application/vnd.ms-asf', playable: false, faststart: false }],
  ])('%s', (_name, p, det, expected) => {
    expect(avOutput(p, det)).toEqual(expected);
  });
});
