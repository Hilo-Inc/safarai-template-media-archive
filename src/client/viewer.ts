// Opens posts in a <dialog> over the grid, steps through the grid's posts, and keeps the browser history in step:
// every shown post is a history entry, and popstate is what shows or closes the viewer after the first open.
import 'media-chrome';
import { initAudio } from './audio';
import { initCarousels } from './carousel';
import { loadNextPage } from './grid';
import { FragmentCache, fragmentOutcome, idFromHref, isSwipe, latest, neighbours, shouldIntercept, step, type NavState } from './viewer-nav';

interface Fragment {
  html: string;
  title: string;
}

interface ViewerState {
  viewer: string;
  /** How many viewer entries deep this one is (1 = the first post opened from the grid). */
  depth: number;
}

const dialog = document.querySelector<HTMLDialogElement>('[data-viewer]');
const grid = document.querySelector<HTMLElement>('[data-grid]');
if (dialog && grid) setUp(dialog, grid);

function setUp(dialog: HTMLDialogElement, grid: HTMLElement): void {
  const body = dialog.querySelector<HTMLElement>('[data-viewer-body]')!;
  const status = dialog.querySelector<HTMLElement>('[data-viewer-status]')!;
  const prev = dialog.querySelector<HTMLButtonElement>('[data-viewer-step="-1"]')!;
  const next = dialog.querySelector<HTMLButtonElement>('[data-viewer-step="1"]')!;
  const cache = new FragmentCache<Fragment>(6);
  const inflight = new Map<string, Promise<Fragment | null>>();
  const begin = latest();
  let gridTitle = document.title;
  let gridScroll = 0;
  /** The post shown, or being fetched for showing. */
  let current: string | null = null;
  let depth = 0;

  const tiles = () => [...grid.querySelectorAll<HTMLAnchorElement>(':scope > a[href^="/p/"]')];
  const idOf = (a: HTMLAnchorElement) => idFromHref(a.href, location.href);
  const moreLink = () => grid.querySelector<HTMLAnchorElement>(':scope > [data-more]');
  const nav = (): NavState => {
    const ids = tiles().map(idOf).filter((id): id is string => id !== null);
    return { ids, index: current ? ids.indexOf(current) : -1, hasMorePages: moreLink() !== null };
  };
  const postUrl = (id: string) => `/p/${encodeURIComponent(id)}`;

  function fetchFragment(id: string): Promise<Fragment | null> {
    const cached = cache.get(id);
    if (cached) return Promise.resolve(cached);
    let request = inflight.get(id);
    if (!request) {
      request = fetch(`/fragments/post/${encodeURIComponent(id)}`, { headers: { accept: 'text/html' } })
        .then(async (res) => {
          if (fragmentOutcome(res) === 'navigate') return null;
          const fragment = { html: await res.text(), title: decodeURIComponent(res.headers.get('x-title') ?? '') || gridTitle };
          cache.set(id, fragment);
          return fragment;
        })
        .catch(() => null)
        .finally(() => inflight.delete(id));
      inflight.set(id, request);
    }
    return request;
  }

  function pauseMedia(): void {
    for (const media of body.querySelectorAll<HTMLMediaElement>('video, audio')) media.pause();
  }

  function updateButtons(): void {
    const state = nav();
    prev.disabled = step(state, -1) === null;
    next.disabled = step(state, 1) === null;
  }

  /** Shows a post; false when a newer request took over or the post had to be loaded as a page instead. */
  async function show(id: string): Promise<boolean> {
    const isCurrent = begin();
    current = id;
    dialog.setAttribute('aria-busy', 'true');
    const fragment = await fetchFragment(id);
    if (!isCurrent()) return false;
    dialog.removeAttribute('aria-busy');
    if (!fragment) {
      location.assign(postUrl(id));
      return false;
    }
    pauseMedia();
    // Server-rendered HTML from our own fragment route (Astro escapes the content).
    body.innerHTML = fragment.html;
    body.scrollTop = 0;
    document.title = fragment.title;
    dialog.setAttribute('aria-label', fragment.title);
    // Stepping keeps focus on the step button, so the new post is otherwise silent to a screen reader.
    if (dialog.open) status.textContent = fragment.title;
    updateButtons();
    if (!dialog.open) dialog.showModal();
    // After showModal: the carousel reads the track's width, which is 0 while the dialog is closed.
    initCarousels(body);
    initAudio(body);
    // Focus the frame, not the first focusable in the post (often a carousel, which keeps the arrow keys), and not
    // <body> (where it falls when the old post is replaced), so the arrow keys step posts. The step buttons keep focus.
    const active = document.activeElement;
    if (!active || active === document.body || body.contains(active)) body.focus({ preventScroll: true });
    for (const near of neighbours(nav())) void fetchFragment(near);
    return true;
  }

  function closeView(): void {
    begin(); // a post still loading must not reopen the viewer
    const last = current;
    dialog.removeAttribute('aria-busy');
    dialog.setAttribute('aria-label', 'Post');
    status.textContent = '';
    pauseMedia();
    dialog.close();
    body.replaceChildren();
    current = null;
    depth = 0;
    document.title = gridTitle;
    window.scrollTo(0, gridScroll);
    const tile = tiles().find((a) => idOf(a) === last);
    if (tile) {
      tile.scrollIntoView({ block: 'nearest' });
      tile.focus({ preventScroll: true });
    }
  }

  /** Close through history, so Back and the viewer never disagree. */
  function requestClose(): void {
    if (depth > 0) history.go(-depth);
    else closeView();
  }

  async function go(dir: -1 | 1): Promise<void> {
    let state = nav();
    let move = step(state, dir);
    if (move?.kind === 'load-more') {
      const link = moreLink()!;
      if (!(await loadNextPage(link))) {
        location.assign(link.href);
        return;
      }
      state = nav();
      move = step(state, dir);
    }
    if (move?.kind !== 'move') return;
    const id = state.ids[move.index]!;
    if (await show(id)) {
      depth += 1;
      history.pushState({ viewer: id, depth } satisfies ViewerState, '', postUrl(id));
    }
  }

  grid.addEventListener('click', (event) => {
    const tile = (event.target as Element).closest<HTMLAnchorElement>('a[href^="/p/"]');
    if (!tile || tile.parentElement !== grid || !shouldIntercept(event)) return;
    const id = idOf(tile);
    if (!id) return;
    event.preventDefault();
    gridTitle = document.title;
    gridScroll = window.scrollY;
    void show(id).then((ok) => {
      if (!ok) return;
      depth = 1;
      history.pushState({ viewer: id, depth } satisfies ViewerState, '', postUrl(id));
    });
  });

  window.addEventListener('popstate', (event) => {
    const state = event.state as Partial<ViewerState> | null;
    if (typeof state?.viewer === 'string') {
      depth = state.depth ?? 1;
      if (!dialog.open) {
        gridTitle = document.title;
        gridScroll = window.scrollY;
      }
      void show(state.viewer);
    } else if (dialog.open) {
      closeView();
    } else {
      begin(); // a first open still loading belongs to the entry just left
    }
  });

  prev.addEventListener('click', () => void go(-1));
  next.addEventListener('click', () => void go(1));
  dialog.querySelector('[data-viewer-close]')!.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestClose();
  });
  // A click on the dialog itself (outside the frame and buttons) is a click on the backdrop.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) requestClose();
  });

  // On the document, not the dialog: focus falls to <body> when the focused step button is disabled at either end.
  document.addEventListener('keydown', (event) => {
    if (!dialog.open || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    // Alt+← is Back and Cmd+←/→ Back/Forward; modified arrows belong to the browser and text selection.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    const target = event.target as Element;
    // Arrow keys belong to carousels, media controls and form fields when focus is in them.
    if (target.closest('[data-carousel], media-controller, input, textarea, select, audio')) return;
    event.preventDefault();
    void go(event.key === 'ArrowLeft' ? -1 : 1);
  });

  let swipe: { x: number; y: number; t: number } | null = null;
  body.addEventListener('pointerdown', (event) => {
    const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
    swipe = touch && !(event.target as Element).closest('.carousel-track, media-controller') ? { x: event.clientX, y: event.clientY, t: event.timeStamp } : null;
  });
  body.addEventListener('pointerup', (event) => {
    if (!swipe) return;
    const dir = isSwipe(event.clientX - swipe.x, event.clientY - swipe.y, event.timeStamp - swipe.t);
    swipe = null;
    if (dir) void go(dir);
  });
  body.addEventListener('pointercancel', () => (swipe = null));
}
