// The stories viewer: a full-screen dialog opened from the day links on a stories page. It plays one month's stories
// in order, moves across months, and keeps the history in step (Back closes it). The rules live in stories-nav.ts.
// Everything fetched is untrusted: it is checked before use, a malformed response counts as a failed fetch, and
// fetched strings only reach the page through textContent or DOM properties.
import { classifyGesture, closeAction, dayRange, ERROR_MS, HOLD_MS, IMAGE_MS, isStale, next, preloadIds, prev, safeUrl, SLOP_PX, storyUrl, tapZone, type StoryRef } from './stories-nav';

interface StoryMedia {
  type: 'image' | 'video';
  src: string;
  alt: string;
  poster: string | null;
  subtitles: { src: string; lang: string | null }[];
}

interface StoryPost {
  caption: string;
  media: StoryMedia;
}

interface MonthIndex {
  month: string;
  posts: StoryRef[];
}

const MONTH_RE = /^\d{4}-\d{2}$/;

const root = document.querySelector<HTMLElement>('[data-stories]');
const dialog = document.querySelector<HTMLDialogElement>('[data-story-viewer]');
if (root && dialog) setUp(root, dialog);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function parseMonth(value: unknown): MonthIndex | null {
  if (!isObject(value) || typeof value.month !== 'string' || !MONTH_RE.test(value.month) || !Array.isArray(value.posts) || value.posts.length === 0) return null;
  const posts: StoryRef[] = [];
  for (const p of value.posts) {
    if (!isObject(p) || !isText(p.id) || typeof p.day !== 'number' || !Number.isFinite(p.day)) return null;
    posts.push({ id: p.id, day: p.day });
  }
  return { month: value.month, posts };
}

/** The first media item of a post, as far as the viewer plays it; null when the post is not shaped like one. */
function parsePost(value: unknown): StoryPost | null {
  if (!isObject(value) || typeof value.caption !== 'string' || !Array.isArray(value.media)) return null;
  const item: unknown = value.media[0];
  if (!isObject(item) || !isText(item.src)) return null;
  const src = safeUrl(item.src, location.href);
  if (!src) return null;
  if (item.type === 'image') {
    return { caption: value.caption, media: { type: 'image', src, alt: typeof item.alt === 'string' ? item.alt : '', poster: null, subtitles: [] } };
  }
  if (item.type !== 'video') return null;
  let poster: string | null = null;
  if (isObject(item.poster) && isText(item.poster.src)) {
    poster = safeUrl(item.poster.src, location.href);
    if (!poster) return null;
  }
  const subtitles: StoryMedia['subtitles'] = [];
  if (Array.isArray(item.subtitles)) {
    for (const t of item.subtitles) {
      if (!isObject(t) || !isText(t.src)) continue;
      const trackSrc = safeUrl(t.src, location.href);
      if (!trackSrc) return null;
      subtitles.push({ src: trackSrc, lang: typeof t.lang === 'string' ? t.lang : null });
    }
  }
  return { caption: value.caption, media: { type: 'video', src, alt: '', poster, subtitles } };
}

function parseMonths(raw: string | undefined): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value.filter((m): m is string => typeof m === 'string' && MONTH_RE.test(m)) : [];
  } catch {
    return [];
  }
}

function parsePageIndex(root: HTMLElement): MonthIndex | null {
  try {
    return parseMonth(JSON.parse(root.querySelector('script[data-stories-index]')?.textContent ?? 'null'));
  } catch {
    return null;
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function setUp(root: HTMLElement, dialog: HTMLDialogElement): void {
  const frame = dialog.querySelector<HTMLElement>('[data-frame]')!;
  const barsEl = dialog.querySelector<HTMLElement>('[data-bars]')!;
  const stage = dialog.querySelector<HTMLElement>('[data-stage]')!;
  const captionEl = dialog.querySelector<HTMLElement>('[data-caption]')!;
  const errorEl = dialog.querySelector<HTMLElement>('[data-error]')!;
  const pauseBtn = dialog.querySelector<HTMLButtonElement>('[data-pause]')!;
  const muteBtn = dialog.querySelector<HTMLButtonElement>('[data-mute]')!;
  const closeBtn = dialog.querySelector<HTMLButtonElement>('[data-close]')!;

  const pageMonth = root.dataset.month ?? '';
  let months = parseMonths(root.dataset.months);
  const pageIndex = parsePageIndex(root);
  // Without a readable index the day links stay plain links.
  if (!pageIndex || pageIndex.month !== pageMonth) return;
  if (!months.includes(pageMonth)) months = [...months, pageMonth];

  const monthCache = new Map<string, MonthIndex>([[pageMonth, pageIndex]]);
  const postCache = new Map<string, { post: StoryPost; at: number }>();
  let month = pageMonth;
  let stories: StoryRef[] = pageIndex.posts;
  let index = 0;
  let opener: HTMLElement | null = null;
  /** True when this viewer pushed its own history entry (a deep link opens without one). */
  let pushed = false;
  /** True from the moment a close went back through history until popstate finishes it; later closes are ignored. */
  let closing = false;
  /** Bumped whenever the shown story changes or the viewer closes, so a slow load can tell it was overtaken. */
  let token = 0;

  let userPaused = false;
  let holdPaused = false;
  let muted = false;
  let video: HTMLVideoElement | null = null;

  let timer: { ms: number; elapsed: number; fill: (fraction: number) => void; done: () => void } | null = null;
  let frameId = 0;
  let lastFrame = 0;
  let holdTimeout = 0;
  let bars: HTMLElement[] = [];
  let barStart = 0;

  const isPaused = () => userPaused || holdPaused || document.visibilityState === 'hidden';

  async function loadPost(id: string): Promise<StoryPost> {
    const cached = postCache.get(id);
    if (cached && !isStale(cached.at, Date.now())) return cached.post;
    const post = parsePost(await getJson(`/api/content/posts/${encodeURIComponent(id)}.json`));
    if (!post) throw new Error('malformed post');
    postCache.set(id, { post, at: Date.now() });
    return post;
  }

  async function loadMonth(m: string): Promise<MonthIndex> {
    const cached = monthCache.get(m);
    if (cached) return cached;
    const loaded = parseMonth(await getJson(`/api/content/index/stories/${m}.json`));
    if (!loaded) throw new Error('malformed month');
    monthCache.set(m, loaded);
    return loaded;
  }

  function preload(): void {
    for (const id of preloadIds(stories, index)) {
      loadPost(id)
        .then((post) => {
          if (post.media.type === 'image') new Image().src = post.media.src;
        })
        .catch(() => {});
    }
  }

  function startTimer(ms: number, fill: (fraction: number) => void, done: () => void): void {
    timer = { ms, elapsed: 0, fill, done };
  }

  function loop(now: number): void {
    frameId = requestAnimationFrame(loop);
    const dt = Math.min(now - lastFrame, 100);
    lastFrame = now;
    if (!timer || isPaused()) return;
    timer.elapsed += dt;
    timer.fill(Math.min(1, timer.elapsed / timer.ms));
    if (timer.elapsed >= timer.ms) {
      const finished = timer;
      timer = null;
      finished.done();
    }
  }

  function applyPause(): void {
    const paused = isPaused();
    if (video) {
      if (paused) video.pause();
      else video.play().catch(() => {});
    }
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
  }

  function setMuted(on: boolean): void {
    muted = on;
    if (video) video.muted = on;
    muteBtn.setAttribute('aria-pressed', String(on));
  }

  function clearStage(): void {
    timer = null;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    video = null;
    stage.replaceChildren();
    captionEl.textContent = '';
  }

  function renderBars(): void {
    const range = dayRange(stories, index);
    barStart = range.start;
    bars = [];
    const spans: HTMLElement[] = [];
    for (let i = range.start; i < range.end; i++) {
      const span = document.createElement('span');
      const fill = document.createElement('i');
      fill.style.width = i < index ? '100%' : '0';
      span.append(fill);
      spans.push(span);
      bars.push(fill);
    }
    barsEl.replaceChildren(...spans);
  }

  const fillBar = (fraction: number) => {
    const bar = bars[index - barStart];
    if (bar) bar.style.width = `${Math.round(fraction * 1000) / 10}%`;
  };

  function fail(): void {
    clearStage();
    errorEl.hidden = false;
    startTimer(ERROR_MS, () => {}, () => void goNext());
  }

  function playVideo(media: StoryMedia): void {
    const el = document.createElement('video');
    el.playsInline = true;
    el.preload = 'auto';
    el.muted = muted;
    if (media.subtitles.length > 0) el.crossOrigin = 'anonymous';
    if (media.poster) el.poster = media.poster;
    el.src = media.src;
    media.subtitles.forEach((s, i) => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.src = s.src;
      track.srclang = s.lang ?? 'und';
      track.label = s.lang ?? 'Subtitles';
      track.default = i === 0;
      el.append(track);
    });
    el.addEventListener('timeupdate', () => {
      if (video === el && Number.isFinite(el.duration) && el.duration > 0) fillBar(el.currentTime / el.duration);
    });
    el.addEventListener('ended', () => {
      if (video === el) void goNext();
    });
    el.addEventListener('error', () => {
      if (video === el) fail();
    });
    video = el;
    stage.replaceChildren(el);
    if (isPaused()) return;
    el.play().catch((err: unknown) => {
      // Autoplay with sound can be refused; try again muted. An AbortError (the element was replaced) is ignored.
      if (!(err instanceof DOMException) || err.name !== 'NotAllowedError' || video !== el) return;
      setMuted(true);
      el.play().catch(() => {});
    });
  }

  async function show(at: number): Promise<void> {
    index = at;
    const mine = ++token;
    const story = stories[at]!;
    clearStage();
    renderBars();
    errorEl.hidden = true;
    history.replaceState({ story: true }, '', storyUrl(month, story.id));
    let post: StoryPost;
    try {
      post = await loadPost(story.id);
    } catch {
      if (mine === token) fail();
      return;
    }
    if (mine !== token) return;
    captionEl.textContent = post.caption;
    const media = post.media;
    if (media.type === 'image') {
      const img = document.createElement('img');
      img.alt = media.alt;
      img.addEventListener('load', () => {
        if (mine === token) startTimer(IMAGE_MS, fillBar, () => void goNext());
      });
      img.addEventListener('error', () => {
        if (mine === token) fail();
      });
      img.src = media.src;
      stage.replaceChildren(img);
    } else {
      playVideo(media);
    }
    preload();
  }

  async function goNext(): Promise<void> {
    const move = next(months, { month, index }, stories.length);
    if (move.kind === 'move') return show(move.index);
    if (move.kind === 'close') return close();
    await changeMonth(move.month, move.at);
  }

  async function goPrev(): Promise<void> {
    const move = prev(months, { month, index });
    if (!move) return;
    if (move.kind === 'move') return show(move.index);
    await changeMonth(move.month, move.at);
  }

  async function changeMonth(target: string, at: 'first' | 'last'): Promise<void> {
    const mine = ++token;
    clearStage();
    let loaded: MonthIndex;
    try {
      loaded = await loadMonth(target);
    } catch {
      if (mine === token) close();
      return;
    }
    if (mine !== token) return;
    month = target;
    stories = loaded.posts;
    return show(at === 'first' ? 0 : stories.length - 1);
  }

  function open(at: number, link: HTMLElement | null, push: boolean): void {
    opener = link;
    pushed = push;
    closing = false;
    userPaused = false;
    holdPaused = false;
    if (push) history.pushState({ story: true }, '', storyUrl(month, stories[at]!.id));
    dialog.showModal();
    frame.focus({ preventScroll: true });
    applyPause();
    setMuted(muted);
    lastFrame = performance.now();
    frameId = requestAnimationFrame(loop);
    void show(at);
  }

  /** X, Esc, a swipe or the end of the last story. While the viewer owns a history entry this goes back and popstate finishes the close. */
  function close(fromHistory = false): void {
    if (!dialog.open || (closing && !fromHistory)) return;
    const owns = pushed && (history.state as { story?: boolean } | null)?.story === true;
    const action = closeAction(pageMonth, month, owns, fromHistory);
    if (action.kind === 'back') {
      closing = true;
      token++;
      clearTimeout(holdTimeout);
      clearStage();
      history.back();
      return;
    }
    token++;
    clearTimeout(holdTimeout);
    cancelAnimationFrame(frameId);
    clearStage();
    errorEl.hidden = true;
    dialog.close();
    pushed = false;
    closing = false;
    if (action.kind === 'navigate') {
      // The page behind shows another month; replace it so no entry is added and no ?s= is left.
      location.replace(action.url);
      return;
    }
    if (action.kind === 'reset') history.replaceState(null, '', action.url);
    opener?.focus({ preventScroll: true });
    opener = null;
  }

  root.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[data-story-id]');
    if (!link || !root.contains(link)) return;
    const at = pageIndex.posts.findIndex((p) => p.id === link.dataset.storyId);
    if (at < 0) return;
    e.preventDefault();
    month = pageMonth;
    stories = pageIndex.posts;
    open(at, link, true);
  });

  // A pointer on the frame: a short press taps (back or forward) or swipes down to close; holding pauses.
  let down: { x: number; y: number; at: number } | null = null;
  const endHold = () => {
    clearTimeout(holdTimeout);
    if (holdPaused) {
      holdPaused = false;
      applyPause();
    }
  };
  frame.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0 || (e.target as Element).closest('button')) return;
    try {
      frame.setPointerCapture(e.pointerId);
    } catch {
      // a stale pointer; the press still works without capture
    }
    down = { x: e.clientX, y: e.clientY, at: performance.now() };
    endHold();
    holdTimeout = window.setTimeout(() => {
      holdPaused = true;
      applyPause();
    }, HOLD_MS);
  });
  frame.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= SLOP_PX) endHold();
  });
  frame.addEventListener('pointerup', (e) => {
    if (!down) return;
    const start = down;
    down = null;
    const held = holdPaused;
    endHold();
    const gesture = classifyGesture(e.clientX - start.x, e.clientY - start.y, performance.now() - start.at);
    if (gesture === 'swipe-close') close();
    else if (gesture === 'tap' && !held) {
      const rect = frame.getBoundingClientRect();
      if (tapZone(e.clientX - rect.left, rect.width) === 'prev') void goPrev();
      else void goNext();
    }
  });
  const cancelPress = () => {
    down = null;
    endHold();
  };
  frame.addEventListener('pointercancel', cancelPress);
  frame.addEventListener('lostpointercapture', cancelPress);

  dialog.addEventListener('keydown', (e) => {
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (plain && e.key === 'ArrowRight') void goNext();
    else if (plain && e.key === 'ArrowLeft') void goPrev();
    else if (e.key === ' ' && !(e.target as Element).closest('button')) {
      userPaused = !userPaused;
      applyPause();
    } else return;
    e.preventDefault();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.addEventListener('visibilitychange', () => {
    if (dialog.open) applyPause();
  });
  window.addEventListener('popstate', () => {
    if (dialog.open) close(true);
  });

  pauseBtn.addEventListener('click', () => {
    userPaused = !userPaused;
    applyPause();
  });
  muteBtn.addEventListener('click', () => setMuted(!muted));
  closeBtn.addEventListener('click', () => close());

  // A shared link: /stories/<month>?s=<id> opens that story.
  const wanted = new URLSearchParams(location.search).get('s');
  if (wanted !== null) {
    history.replaceState(null, '', `/stories/${pageMonth}`);
    const at = pageIndex.posts.findIndex((p) => p.id === wanted);
    if (at >= 0) open(at, null, false);
  }
}
