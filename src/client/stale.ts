/** Password mode: media URLs are presigned for 1 hour, so a tab hidden for 50+ minutes reloads when shown again. Never on admin pages, where a reload would cut off an upload. */
const STALE_MS = 50 * 60 * 1000;

if (document.documentElement.dataset.visibility === 'password' && document.documentElement.dataset.admin === undefined) {
  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt !== null && Date.now() - hiddenAt > STALE_MS) location.reload();
  });
}
