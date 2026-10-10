import type { Post } from '../schema/post';
import { filterPosts, type PostFilter } from './admin-view';
import { api } from './upload';

type Row = { id: string; caption: string; hidden: boolean; featured: boolean };
const list = document.querySelector<HTMLElement>('[data-posts]')!;
// Rows are read from the server-rendered list (Astro escapes the attributes), not from injected JSON.
const rows: Row[] = [...list.querySelectorAll<HTMLElement>(':scope > li')].map((li) => ({
  id: li.dataset.id!,
  caption: li.dataset.caption ?? '',
  hidden: li.querySelector<HTMLInputElement>('[data-field="hidden"]')!.checked,
  featured: li.querySelector<HTMLInputElement>('[data-field="featured"]')!.checked,
}));
const byId = new Map(rows.map((r) => [r.id, r]));
const count = document.querySelector<HTMLElement>('[data-count]')!;

/** Saves one field. Marks the element while saving; on failure shows the error and calls `revert`. */
async function save(li: HTMLElement, el: HTMLElement, patch: Record<string, unknown>, revert: () => void): Promise<Post | null> {
  const error = li.querySelector<HTMLElement>('[data-error]')!;
  error.textContent = '';
  el.classList.add('saving');
  try {
    const { post } = await api<{ post: Post }>('PATCH', `/api/posts/${encodeURIComponent(li.dataset.id!)}`, patch);
    return post;
  } catch (e) {
    revert();
    error.textContent = (e as Error).message;
    return null;
  } finally {
    el.classList.remove('saving');
  }
}

for (const box of list.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-field]')) {
  box.addEventListener('change', async () => {
    const li = box.closest('li')!;
    const field = box.dataset.field as 'hidden' | 'featured';
    const post = await save(li, box, { [field]: box.checked }, () => (box.checked = !box.checked));
    if (post) byId.get(li.dataset.id!)![field] = box.checked;
  });
}

function textField(label: string, value: string, multiline: boolean, onSave: (value: string, el: HTMLElement, revert: () => void) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.style.display = 'grid';
  wrap.append(label);
  const input = multiline ? document.createElement('textarea') : document.createElement('input');
  input.value = value;
  let saved = value;
  input.addEventListener('blur', () => {
    if (input.value === saved) return;
    const next = input.value;
    onSave(next, input, () => (input.value = saved));
    saved = next;
  });
  wrap.append(input);
  return wrap;
}

for (const button of list.querySelectorAll<HTMLButtonElement>('[data-edit]')) {
  button.addEventListener('click', async () => {
    const li = button.closest('li')!;
    button.disabled = true;
    let post: Post;
    try {
      // GET /api/content returns the post itself, with URLs signed.
      post = await api<Post>('GET', `/api/content/posts/${encodeURIComponent(li.dataset.id!)}.json`);
    } catch (e) {
      li.querySelector<HTMLElement>('[data-error]')!.textContent = (e as Error).message;
      button.disabled = false;
      return;
    }
    const fields = document.createElement('div');
    fields.style.display = 'grid';
    fields.style.gap = '0.4rem';
    fields.append(
      textField('Caption', post.caption, true, (caption, el, revert) => void save(li, el, { caption }, revert)),
      textField('Place', post.location && 'name' in post.location ? (post.location.name ?? '') : '', false, (place, el, revert) =>
        void save(li, el, { place: place.trim() || null }, revert),
      ),
    );
    post.media.forEach((item, i) => {
      if (item.type !== 'image') return;
      fields.append(textField(`Alt text, image ${i + 1}`, item.alt ?? '', false, (alt, el, revert) => void save(li, el, { alt: { [String(i)]: alt.trim() || null } }, revert)));
    });
    button.replaceWith(fields);
  });
}

const form = document.querySelector<HTMLFormElement>('[data-filter]')!;
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('input', () => {
  const data = new FormData(form);
  const filter: PostFilter = { text: String(data.get('text') ?? ''), show: (data.get('show') as PostFilter['show']) ?? 'all' };
  // byId holds the same objects as rows, so checkbox changes are already reflected here.
  const shown = new Set(filterPosts(rows, filter).map((p) => p.id));
  for (const li of list.querySelectorAll<HTMLElement>(':scope > li')) li.hidden = !shown.has(li.dataset.id!);
  count.textContent = `${shown.size} posts`;
});
