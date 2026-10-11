// The demo's placeholder posts: what a plausible personal archive of landscapes and small trips might hold.
import type { Mood, Scene } from './scene';

export type Ratio = '1:1' | '4:5' | '16:9' | '9:16';

export type DemoMedia =
  | { type: 'image'; mood: Mood; scene: Scene; ratio: Ratio; seed: number }
  | { type: 'video'; mood: Mood; ratio: '9:16' | '16:9'; seconds: number; seed: number }
  | { type: 'audio'; seconds: number };

export interface DemoPost {
  shortcode: string;
  /** gallery-dl format, UTC: "YYYY-MM-DD HH:MM:SS". */
  date: string;
  caption: string;
  place: string | null;
  featured: boolean;
  media: DemoMedia[];
}

type Item =
  | { type: 'image'; mood: Mood; scene: Scene; ratio: Ratio }
  | { type: 'video'; mood: Mood; ratio: '9:16' | '16:9'; seconds: number }
  | { type: 'audio'; seconds: number };

interface Row {
  date: string;
  caption: string;
  place?: string;
  featured?: true;
  items: Item[];
}

const photo = (mood: Mood, scene: Scene, ratio: Ratio): Item => ({ type: 'image', mood, scene, ratio });
const clip = (mood: Mood, ratio: '9:16' | '16:9', seconds: number): Item => ({ type: 'video', mood, ratio, seconds });
const trip = (mood: Mood, ratio: Ratio, scenes: Scene[]): Item[] => scenes.map((scene) => photo(mood, scene, ratio));

const ROWS: Row[] = [
  { date: '2026-09-14 18:52:00', caption: "Last light over the bay. Didn't want to leave. #sunset #sea", place: 'Porto', items: [photo('dusk', 'sea', '4:5')] },
  { date: '2026-08-30 09:15:00', caption: 'Three days in the mountains, in no particular order.\n\nDay one was mostly fog, day two was this. #hiking #travel', place: 'Dolomites', items: trip('dawn', '4:5', ['peaks', 'hills', 'peaks']) },
  { date: '2026-08-21 19:40:00', caption: 'golden hour on repeat #sunset', items: [clip('dusk', '9:16', 6)] },
  { date: '2026-08-10 13:05:00', caption: 'Picnic spot, found by accident 🌿 #weekend', items: [photo('noon', 'hills', '1:1')] },
  { date: '2026-07-28 23:10:00', caption: 'The sea at night is louder than you think. #sea #nightsky', place: 'Brittany', items: [photo('night', 'sea', '16:9')] },
  { date: '2026-07-19 05:40:00', caption: '5:40am. Worth it. #morning', items: [clip('dawn', '9:16', 5)] },
  { date: '2026-07-02 11:20:00', caption: 'Switchbacks all morning, then this. #hiking', place: 'Picos de Europa', items: [photo('noon', 'peaks', '4:5')] },
  { date: '2026-06-15 14:30:00', caption: 'Ferry crossing, in real time. #travel #sea', items: [clip('noon', '16:9', 8)] },
  { date: '2026-05-30 20:05:00', caption: 'Long shadows season.', items: [photo('dusk', 'hills', '1:1')] },
  { date: '2026-05-11 16:45:00', caption: "Coastal walk, 14 km, five photos that don't do it justice. #travel #sea", place: 'Cornwall', items: trip('noon', '1:1', ['sea', 'hills', 'sea', 'peaks', 'sea']) },
  { date: '2026-04-26 22:30:00', caption: 'night drive playlist #roadtrip', items: [clip('night', '9:16', 7)] },
  { date: '2026-04-03 07:10:00', caption: 'Fog in the valley again.', items: [photo('dawn', 'hills', '9:16')] },
  { date: '2026-03-18 18:20:00', caption: 'A short sketch I recorded on the train home. Headphones on.', items: [{ type: 'audio', seconds: 20 }] },
  { date: '2026-02-21 21:50:00', caption: 'Clear sky, cold hands, many stars. #nightsky #hiking', items: [photo('night', 'peaks', '4:5')] },
  { date: '2026-01-30 12:00:00', caption: 'wind 🌬️ #sea', items: [clip('noon', '9:16', 4)] },
  { date: '2026-01-01 16:30:00', caption: 'First sunset of the year. #sunset', items: [photo('dusk', 'sea', '16:9')] },
  { date: '2025-12-12 10:30:00', caption: 'Snow day, sort of. More like slush day.', items: [photo('noon', 'hills', '4:5')] },
  { date: '2025-11-23 17:00:00', caption: 'Timelapse from the hill behind the house. #sunset', items: [clip('dusk', '16:9', 6)] },
  { date: '2025-10-19 15:15:00', caption: 'Before and after the rain.', items: trip('dusk', '16:9', ['hills', 'hills']) },
  { date: '2025-09-06 07:00:00', caption: 'Swim at 7. Water: brisk. #morning #sea', items: [photo('dawn', 'sea', '1:1')] },
  { date: '2025-08-17 06:05:00', caption: 'sunrise from the tent door #hiking', items: [clip('dawn', '9:16', 6)] },
  { date: '2025-08-02 22:40:00', caption: 'Moon came up behind the ridge just as we got back.', featured: true, items: [photo('night', 'hills', '1:1')] },
  { date: '2025-07-12 13:30:00', caption: 'Ridge walk. Legs: gone. #hiking #travel', items: [photo('noon', 'peaks', '16:9')] },
  { date: '2025-06-21 18:00:00', caption: 'ok one more swim #sea', items: [clip('noon', '9:16', 5)] },
  { date: '2025-05-25 20:30:00', caption: 'Fields on the way home. #roadtrip #sunset', items: [photo('dusk', 'hills', '4:5')] },
  { date: '2025-04-13 06:50:00', caption: 'Alpenglow, finally. #hiking #morning', items: [photo('dawn', 'peaks', '1:1')] },
  { date: '2025-03-08 21:15:00', caption: 'Lighthouse beam, 3 seconds per turn. #nightsky #sea', items: [clip('night', '16:9', 7)] },
  { date: '2025-02-15 19:00:00', caption: 'Winter cabin weekend. Fire, books, snow, repeat.\n\nNo signal, no complaints.', items: trip('night', '4:5', ['peaks', 'hills', 'peaks', 'hills']) },
  { date: '2025-01-19 11:45:00', caption: 'Tide pools.', items: [photo('noon', 'sea', '9:16')] },
  { date: '2024-12-28 16:20:00', caption: 'the walk back #sunset', items: [clip('dusk', '9:16', 8)] },
  { date: '2024-12-02 08:10:00', caption: 'Frost on everything.', items: [photo('dawn', 'hills', '16:9')] },
  { date: '2024-10-27 17:30:00', caption: 'October colours, slightly late. #travel', items: [photo('dusk', 'peaks', '1:1')] },
  { date: '2024-09-14 12:40:00', caption: 'harbour sounds #travel #sea', items: [clip('noon', '9:16', 6)] },
  { date: '2024-08-19 23:30:00', caption: 'Full moon over the harbour. #nightsky #sea', items: [photo('night', 'sea', '4:5')] },
  { date: '2024-03-03 07:30:00', caption: 'Quiet start. #morning', items: [photo('dawn', 'sea', '16:9')] },
  { date: '2023-11-04 12:00:00', caption: 'First post here. Mostly landscapes, probably.', items: [photo('noon', 'hills', '1:1')] },
];

export function demoCatalog(): DemoPost[] {
  return ROWS.map((row, i) => ({
    shortcode: `d${String(i + 1).padStart(2, '0')}`,
    date: row.date,
    caption: row.caption,
    place: row.place ?? null,
    featured: row.featured ?? false,
    media: row.items.map((item, j) => (item.type === 'audio' ? item : { ...item, seed: (i + 1) * 10 + j })),
  }));
}
