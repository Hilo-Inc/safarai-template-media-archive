/** Infinite scroll: replace each "More" link, when it comes into view, with the next page's tiles. */
async function loadMore(link: HTMLAnchorElement, observer: IntersectionObserver): Promise<void> {
  observer.unobserve(link);
  const url = link.dataset.fragment;
  if (!url) return;
  try {
    const res = await fetch(url, { headers: { accept: 'text/html' } });
    // A redirect means the session ended (password mode): let the full page handle it.
    if (!res.ok || res.redirected) throw new Error(String(res.status));
    const doc = new DOMParser().parseFromString(`<body>${await res.text()}</body>`, 'text/html');
    const nodes = [...doc.body.children];
    link.replaceWith(...nodes);
    for (const node of nodes) if (node instanceof HTMLAnchorElement && node.dataset.more !== undefined) observer.observe(node);
  } catch {
    location.assign(link.href);
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) if (entry.isIntersecting) void loadMore(entry.target as HTMLAnchorElement, observer);
  },
  { rootMargin: '800px 0px' },
);
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-grid] [data-more]')) observer.observe(link);
