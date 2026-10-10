import type { Post } from '../schema/post';
import { ALT_MAX, CAPTION_MAX, PLACE_MAX } from '../schema/patch-limits';
import { filterPosts, SavedValue, type PostFilter } from './admin-view';
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
async function save(li: HTMLElement, el: HTMLElement, patch: Record<string, unknown>, revert: () => void, confirm: () => void = () => undefined): Promise<Post | null> {
  const error = li.querySelector<HTMLElement>('[data-error]')!;
  error.textContent = '';
  el.classList.add('saving');
  try {
    const { post } = await api<{ post: Post }>('PATCH', `/api/posts/${encodeURIComponent(li.dataset.id!)}`, patch);
    confirm();
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

function textField(label: string, value: string, multiline: boolean, maxLength: number, onSave: (value: string, el: HTMLElement, revert: () => void, confirm: () => void) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.style.display = 'grid';
  wrap.append(label);
  const input = multiline ? document.createElement('textarea') : document.createElement('input');
  input.value = value;
  input.maxLength = maxLength;
  const saved = new SavedValue(value);
  input.addEventListener('blur', () => {
    const attempt = saved.begin(input.value);
    if (!attempt) return;
    const revert = () => {
      const kept = attempt.revert();
      // Only put the saved text back if the user has not typed something else since.
      if (input.value === attempt.next) input.value = kept;
    };
    onSave(attempt.next, input, revert, attempt.confirm);
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
      textField('Caption', post.caption, true, CAPTION_MAX, (caption, el, revert, confirm) => {
        // The search filter looks at captions, so keep its copy current.
        void save(li, el, { caption }, revert, confirm).then((saved) => {
          if (saved) byId.get(li.dataset.id!)!.caption = caption;
        });
      }),
      textField('Place', post.location && 'name' in post.location ? (post.location.name ?? '') : '', false, PLACE_MAX, (place, el, revert, confirm) =>
        void save(li, el, { place: place.trim() || null }, revert, confirm),
      ),
    );
    post.media.forEach((item, i) => {
      if (item.type !== 'image') return;
      fields.append(textField(`Alt text, image ${i + 1}`, item.alt ?? '', false, ALT_MAX, (alt, el, revert, confirm) => void save(li, el, { alt: { [String(i)]: alt.trim() || null } }, revert, confirm)));
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
