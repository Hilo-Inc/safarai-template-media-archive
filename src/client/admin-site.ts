import { cleanLinks } from './admin-view';
import { api } from './upload';

const siteForm = document.querySelector<HTMLFormElement>('[data-site-form]')!;
const siteStatus = document.querySelector<HTMLElement>('[data-site-status]')!;

siteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(siteForm);
  const rows = [...siteForm.querySelectorAll<HTMLElement>('[data-link]')].map((row) => ({
    label: row.querySelector<HTMLInputElement>('[name="label"]')!.value,
    url: row.querySelector<HTMLInputElement>('[name="url"]')!.value,
  }));
  // The server accepts only http(s) links; check here too so the form says why before sending.
  const cleaned = cleanLinks(rows);
  if (!cleaned.ok) {
    siteStatus.textContent = cleaned.error;
    return;
  }
  const { links } = cleaned;
  siteStatus.textContent = 'Saving…';
  try {
    await api('PUT', '/api/site', { title: String(data.get('title')).trim(), bio: String(data.get('bio') ?? ''), links });
    siteStatus.textContent = 'Saved.';
  } catch (error) {
    siteStatus.textContent = (error as Error).message;
  }
});

const avatarForm = document.querySelector<HTMLFormElement>('[data-avatar-form]')!;
const avatarStatus = document.querySelector<HTMLElement>('[data-avatar-status]')!;

avatarForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  avatarStatus.textContent = 'Uploading…';
  const file = new FormData(avatarForm).get('file');
  if (!(file instanceof File) || file.size === 0) {
    avatarStatus.textContent = 'Choose an image';
    return;
  }
  // Multipart with the File as the only part: the browser sets Content-Length (the endpoint answers 411 without it) and the boundary itself.
  const body = new FormData();
  body.set('file', file);
  let res: Response;
  try {
    res = await fetch('/api/site/avatar', { method: 'POST', body });
  } catch {
    avatarStatus.textContent = 'Upload failed. Check your connection and try again.';
    return;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    avatarStatus.textContent = data.error ?? `Upload failed (${res.status})`;
    return;
  }
  location.reload();
});
