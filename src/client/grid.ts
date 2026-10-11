/** Infinite scroll: replace each "More" link, when it comes into view, with the next page's tiles. The viewer also calls loadNextPage. */
const pending = new WeakMap<HTMLAnchorElement, Promise<boolean>>();

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const link = entry.target as HTMLAnchorElement;
      observer.unobserve(link);
      void loadNextPage(link).then((ok) => {
        // A failure (or a redirect: the session ended in password mode) falls back to the plain next page.
        if (!ok) location.assign(link.href);
      });
    }
  },
  { rootMargin: '800px 0px' },
);

/** Replaces a "More" link with the next page's tiles. Resolves false when the page could not be loaded. */
export function loadNextPage(link: HTMLAnchorElement): Promise<boolean> {
  let load = pending.get(link);
  if (!load) {
    load = load_(link);
    pending.set(link, load);
  }
  return load;
}

async function load_(link: HTMLAnchorElement): Promise<boolean> {
  const url = link.dataset.fragment;
  if (!url) return false;
  try {
    const res = await fetch(url, { headers: { accept: 'text/html' } });
    if (!res.ok || res.redirected) return false;
    const doc = new DOMParser().parseFromString(`<body>${await res.text()}</body>`, 'text/html');
    const nodes = [...doc.body.children];
    observer.unobserve(link);
    link.replaceWith(...nodes);
    for (const node of nodes) if (node instanceof HTMLAnchorElement && node.dataset.more !== undefined) observer.observe(node);
    return true;
  } catch {
    return false;
  }
}

for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-grid] [data-more]')) observer.observe(link);
