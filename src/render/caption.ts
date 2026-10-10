import type { MentionsMode } from '../config/schema';
import { TAG_RE } from '../indexer/plan-index';

export type CaptionPart =
  | { type: 'text'; text: string }
  | { type: 'tag'; text: string; href: string | null }
  | { type: 'mention'; text: string; href: string | null }
  | { type: 'url'; text: string; href: string };

const PROFILES: Record<string, (handle: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}/`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  soundcloud: (h) => `https://soundcloud.com/${h}`,
  facebook: (h) => `https://www.facebook.com/${h}`,
};

/** The handle is percent-encoded, so it can never add path segments, a query or a fragment. */
export function profileUrl(platform: string, handle: string): string | null {
  return PROFILES[platform]?.(encodeURIComponent(handle)) ?? null;
}

// One pass over the caption. Groups: 1 URL, 2 hashtag body, 3 the character before a mention, 4 mention handle.
// Only `http://` and `https://` start a URL (case-sensitive), so no other scheme can become a link.
// Trailing punctuation is not part of a URL; a mention needs a non-word character (or the start) before the @.
const TOKEN = /(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'])|#([\p{L}\p{N}_]+)|(^|[^\p{L}\p{N}_.@])@([A-Za-z0-9._]{0,29}[A-Za-z0-9_])/gu;

/** Splits a caption into plain text and links. The page prints `text` as text, so nothing here is ever HTML. */
export function captionParts(text: string, opts: { platform: string; mentions: MentionsMode }): CaptionPart[] {
  const out: CaptionPart[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out.at(-1);
    if (last?.type === 'text') last.text += t;
    else out.push({ type: 'text', text: t });
  };
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    if (m[1]) {
      pushText(text.slice(at, start));
      out.push({ type: 'url', text: m[1], href: m[1] });
    } else if (m[2]) {
      pushText(text.slice(at, start));
      const tag = m[2].toLowerCase();
      out.push({ type: 'tag', text: `#${m[2]}`, href: TAG_RE.test(tag) ? `/tags/${encodeURIComponent(tag)}` : null });
    } else {
      pushText(text.slice(at, start) + m[3]!);
      const handle = m[4]!;
      out.push({ type: 'mention', text: `@${handle}`, href: opts.mentions === 'link' ? profileUrl(opts.platform, handle) : null });
    }
    at = start + m[0].length;
  }
  pushText(text.slice(at));
  return out;
}

/** The first non-empty line, at most `max` characters (counting emoji as one). */
export function firstLine(text: string, max: number): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const chars = Array.from(line);
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join('')}…`;
}
