import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { makeJpeg, makeMp4, SRT } from '../helpers/media';

/** A synthetic Instagram JSON export in the real export's shapes. Nothing in it comes from a real account. */
export const IG = 'your_instagram_activity/media/';

/** How Meta writes UTF-8: each byte as its own \u00XX code unit. */
export const moji = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

const DEVICE = [{ latitude: 48.85, longitude: 2.35 }, { device_id: 'android-test-device', source_type: '63' }];

export function instagramJson(opts: { malformed?: boolean } = {}): Record<string, string> {
  const posts1: unknown[] = [
    // A 3-item carousel with GPS and a device id on its first item.
    {
      title: moji('Café trip 🌊 #travel'),
      creation_timestamp: 1704103200,
      media: [
        { uri: 'media/posts/202401/c1.jpg', creation_timestamp: 1704103200, title: '', media_metadata: { photo_metadata: { exif_data: DEVICE } } },
        { uri: 'media/posts/202401/c2.jpg', creation_timestamp: 1704103200, title: '' },
        { uri: 'media/posts/202401/c3.mp4', creation_timestamp: 1704103200, title: '' },
      ],
    },
    // Caption and timestamp only on the item; the file lives under media/other/.
    { media: [{ uri: 'media/other/single.jpg', creation_timestamp: 1706000000, title: moji('Only on the item ✨') }] },
    // A video post whose caption is the "Media" placeholder.
    { title: '', creation_timestamp: 1707000000, media: [{ uri: 'media/posts/202402/clip.mp4', creation_timestamp: 1707000000, title: 'Media' }] },
    { title: 'Archived one', creation_timestamp: 1708000000, media: [{ uri: 'media/posts/202402/archived.jpg', creation_timestamp: 1708000000, title: '' }] },
    { title: 'Deleted one', creation_timestamp: 1709000000, media: [{ uri: 'media/posts/202403/deleted.jpg', creation_timestamp: 1709000000, title: '' }] },
    // Every uri is unsafe: escaping, absolute, into a denied folder, or through "..".
    {
      title: 'Escape',
      creation_timestamp: 1709100000,
      media: [
        { uri: '../outside.jpg' },
        { uri: '/abs.jpg' },
        { uri: 'your_instagram_activity/messages/inbox/someone_1/photo.jpg' },
        { uri: 'media/../your_instagram_activity/messages/inbox/someone_1/photo.jpg' },
      ],
    },
  ];
  if (opts.malformed !== false) posts1.push('not a record');

  const json: Record<string, unknown> = {
    [`${IG}posts_1.json`]: posts1,
    [`${IG}posts_2.json`]: [{ title: 'Draft', creation_timestamp: 1710000000, media: [{ uri: 'media/posts/202403/draft.jpg', creation_timestamp: 1710000000, title: '' }] }],
    [`${IG}posts.json`]: [
      {
        timestamp: 1706000001, fbid: '1', media: [],
        label_values: [
          { label: 'Media', media: [{ uri: 'media/other/single.jpg', title: '' }] },
          { label: 'Published', value: 'True' }, { label: 'Draft', value: 'False' },
          { label: 'Latitude', value: '67.9481' }, { label: 'Longitude', value: '13.1322' },
        ],
      },
      {
        timestamp: 1710000001, fbid: '2', media: [],
        label_values: [{ label: 'Media', media: [{ uri: 'media/posts/202403/draft.jpg', title: '' }] }, { label: 'Published', value: 'False' }],
      },
    ],
    [`${IG}reels.json`]: {
      ig_reels_media: [{
        media: [{
          uri: 'media/other/reel.mp4',
          creation_timestamp: 1711000000,
          title: moji('Reel night 🎶 #music'),
          media_metadata: { video_metadata: {
            music_genre: 'Pop',
            subtitles: { uri: 'media/other/reel.srt' },
            exif_data: [{ latitude: 43.67, longitude: -79.39 }, { device_id: 'android-test-device', source_type: '63' }],
          } },
        }],
      }],
    },
    [`${IG}stories.json`]: {
      ig_stories: [
        { uri: 'media/other/s3.jpg', creation_timestamp: 1705320000, title: '' }, // 2024-01-15 12:00 UTC
        { uri: 'media/stories/202401/s2.mp4', creation_timestamp: 1706702400, title: 'Line one\nLine two' }, // 2024-01-31 12:00 UTC
        { uri: 'media/stories/202401/s1.jpg', creation_timestamp: 1706743800, title: '' }, // 2024-01-31 23:30 UTC
        { uri: 'media/other/s4', creation_timestamp: 1706864400, title: '' }, // 2024-02-02 09:00 UTC, no extension
        { uri: 'https://example.invalid/s5.jpg', creation_timestamp: 1706900000, title: '' },
      ],
    },
    [`${IG}profile_photos.json`]: {
      ig_profile_picture: [
        { uri: 'media/other/old.jpg', creation_timestamp: 1600000000, title: '' },
        { uri: 'media/other/new.jpg', creation_timestamp: 1700000000, title: '' },
      ],
    },
    [`${IG}archived_posts.json`]: {
      ig_archived_post_media: [{ title: 'Archived one', creation_timestamp: 1708000000, media: [{ uri: 'media/posts/202402/archived.jpg', creation_timestamp: 1708000000, title: '' }] }],
    },
    [`${IG}recently_deleted_content.json`]: [
      { timestamp: 1709000001, media: [], label_values: [{ label: 'Media', media: [{ uri: 'media/posts/202403/deleted.jpg', title: '' }] }] },
    ],
    [`${IG}igtv_videos.json`]: { ig_igtv_media: [{ media: [{ uri: 'media/other/igtv.mp4', creation_timestamp: 1712000000, title: 'IGTV' }] }] },
    'your_instagram_activity/messages/inbox/someone_1/message_1.json': { messages: [] },
    'personal_information/personal_information/personal_information.json': { profile_user: [] },
    'connections/followers_and_following/followers_1.json': [],
  };
  return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, JSON.stringify(v)]));
}

export const INSTAGRAM_MEDIA: Record<string, 'jpg' | 'gps-jpg' | 'mp4' | 'gps-mp4' | 'srt'> = {
  'media/posts/202401/c1.jpg': 'gps-jpg',
  'media/posts/202401/c2.jpg': 'jpg',
  'media/posts/202401/c3.mp4': 'mp4',
  'media/other/single.jpg': 'jpg',
  'media/posts/202402/clip.mp4': 'mp4',
  'media/posts/202402/archived.jpg': 'jpg',
  'media/posts/202403/deleted.jpg': 'jpg',
  'media/posts/202403/draft.jpg': 'jpg',
  'media/other/reel.mp4': 'gps-mp4',
  'media/other/reel.srt': 'srt',
  'media/other/s3.jpg': 'jpg',
  'media/stories/202401/s2.mp4': 'mp4',
  'media/stories/202401/s1.jpg': 'jpg',
  'media/other/s4': 'jpg',
  'media/other/old.jpg': 'jpg',
  'media/other/new.jpg': 'jpg',
  'media/other/igtv.mp4': 'mp4',
  'media/posts/202407/unreferenced.jpg': 'jpg',
  'your_instagram_activity/messages/inbox/someone_1/photo.jpg': 'jpg',
};

export function instagramFiles(opts: { root?: string; malformed?: boolean; omit?: string[] } = {}): Record<string, string | { size: number }> {
  const root = opts.root ?? '';
  const omit = new Set(opts.omit ?? []);
  const all: Record<string, string | { size: number }> = { ...instagramJson(opts) };
  for (const path of Object.keys(INSTAGRAM_MEDIA)) all[path] = { size: 100 };
  return Object.fromEntries(Object.entries(all).filter(([p]) => !omit.has(p)).map(([p, v]) => [root + p, v]));
}

/** Real media for every fixture path (docker only: needs exiftool and ffmpeg). JPEGs with "gps" carry GPS EXIF; MP4s always carry a location atom. */
export async function writeInstagramMedia(dir: string): Promise<void> {
  for (const [path, type] of Object.entries(INSTAGRAM_MEDIA)) {
    const file = join(dir, path);
    await mkdir(dirname(file), { recursive: true });
    if (type === 'srt') await writeFile(file, SRT);
    else if (type === 'mp4' || type === 'gps-mp4') await makeMp4(file, { width: 360, height: 640, seconds: 1 });
    else await makeJpeg(file, { width: 360, height: 640, gps: type === 'gps-jpg' });
  }
}
