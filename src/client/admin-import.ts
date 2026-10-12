import { formatBytes, formatDate } from '../render/format';
import { importActions, importLabel, instagramSummary, missingLine, selectionSummary, type ImportAction, type ImportView } from './admin-view';
import { listFilesNamingZip, planUploads, sourceListing, type Source } from './listing';
import { api, uploadAll } from './upload';
import type { Kind } from '../config/schema';
import { chooseImporter } from '../importers/registry';
import type { ListingEntry } from '../importers/types';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const drop = $('[data-drop]');
const planBox = $('[data-plan]');
const planText = $('[data-plan-text]');
const planError = $('[data-plan-error]');
const progressBox = $('[data-progress]');
const bar = $<HTMLProgressElement>('[data-bar]');
const progressText = $('[data-progress-text]');
const list = $('[data-imports]');
const stopButton = $<HTMLButtonElement>('[data-stop]');

let busy = false;
/** Set when "Resume upload" asked for files again: the import they belong to. */
let resumeId: string | null = null;
let pending: { id: string; files: ListingEntry[]; sources: Map<string, Source> } | null = null;
let controller: AbortController | null = null;

window.addEventListener('beforeunload', (event) => {
  if (busy) event.preventDefault();
});

// ---- Picking files -------------------------------------------------------

async function filesFromDrop(items: DataTransferItemList): Promise<File[]> {
  const entries = [...items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => e !== null);
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      // Keep the folder path, as <input webkitdirectory> does.
      out.push(prefix ? new File([file], file.name, { lastModified: file.lastModified, type: file.type }) : file);
      if (prefix) Object.defineProperty(out.at(-1)!, 'webkitRelativePath', { value: `${prefix}${file.name}` });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}

async function handleFiles(files: File[]): Promise<void> {
  if (busy || files.length === 0) return;
  planError.textContent = '';
  planText.textContent = 'Reading the file list…';
  planBox.hidden = false;
  progressBox.hidden = true; // a finished or stopped upload's bar and Stop button
  $<HTMLButtonElement>('[data-upload]').disabled = true;
  try {
    const { sources, duplicates } = await listFilesNamingZip(files);
    if (pending) {
      // A new selection replaces the earlier one; that import has no uploads yet, so remove it instead of leaving it in `uploading`.
      const old = pending;
      pending = null;
      // The import being resumed must stay: it is the one that continues below.
      if (old.id !== resumeId) await api('DELETE', `/api/imports/${old.id}`, {}).catch(() => undefined);
    }
    if (resumeId) return await resume(resumeId, sources);
    const listing = sourceListing(sources);
    const chosen = chooseImporter(listing);
    if (!chosen.ok) throw new Error(chosen.reason);
    const kinds = JSON.parse(drop.dataset.kinds ?? '[]') as Kind[];
    const selection = await chosen.importer.select(listing, kinds);
    if (!selection.ok) throw new Error(selection.reason);
    const created = await api<{ id: string; files: ListingEntry[] }>('POST', '/api/imports', { importer: chosen.importer.name, entries: selection.files });
    pending = { id: created.id, files: created.files, sources };
    const head = chosen.importer.name === 'instagram' ? instagramSummary(created.files) : selectionSummary(created.files, sources.size);
    planText.textContent = [head, duplicates > 0 ? `${duplicates} repeated files are uploaded once.` : '', missingLine(selection.missing ?? 0)].filter(Boolean).join(' ');
    $<HTMLButtonElement>('[data-upload]').disabled = false;
    void refresh();
  } catch (error) {
    planText.textContent = '';
    planError.textContent = (error as Error).message;
  }
}

drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer) void filesFromDrop(e.dataTransfer.items).then(handleFiles);
});
for (const input of document.querySelectorAll<HTMLInputElement>('[data-pick-files], [data-pick-folder]')) {
  input.addEventListener('change', () => {
    void handleFiles([...(input.files ?? [])]);
    input.value = '';
  });
}

// ---- Uploading -----------------------------------------------------------

async function upload(id: string, todo: Source[], alreadyBytes: number): Promise<void> {
  busy = true;
  stopButton.disabled = false;
  controller = new AbortController();
  planBox.hidden = true;
  progressBox.hidden = false;
  try {
    const { failed } = await uploadAll(id, todo, {
      alreadyBytes,
      signal: controller.signal,
      onProgress: ({ bytesDone, bytesTotal }) => {
        bar.value = bytesTotal === 0 ? 1 : bytesDone / bytesTotal;
        progressText.textContent = `${formatBytes(bytesDone)} of ${formatBytes(bytesTotal)} uploaded`;
      },
    });
    if (controller.signal.aborted) {
      progressText.textContent = 'Stopped. Use "Resume upload" to finish later.';
      return;
    }
    if (failed.length > 0) {
      const shown = failed.slice(0, 3).map((f) => `${f.path} (${f.error})`).join('; ');
      progressText.textContent = `${failed.length} files did not upload: ${shown}${failed.length > 3 ? '; and more' : ''}. Use "Resume upload" to try them again.`;
      return;
    }
    await api('POST', `/api/imports/${id}/start`, {});
    progressText.textContent = 'Uploaded. Processing has started.';
  } catch (error) {
    progressText.textContent = (error as Error).message;
  } finally {
    busy = false;
    stopButton.disabled = true;
    controller = null;
    pending = null;
    void refresh();
  }
}

$('[data-upload]').addEventListener('click', () => {
  if (!pending) return;
  const { id, sources } = pending;
  $<HTMLButtonElement>('[data-upload]').disabled = true;
  planError.textContent = '';
  resume(id, sources)
    .catch((error: Error) => {
      planError.textContent = error.message;
    })
    .finally(() => {
      $<HTMLButtonElement>('[data-upload]').disabled = pending === null;
    });
});
$('[data-discard]').addEventListener('click', async () => {
  planBox.hidden = true;
  if (pending) await api('DELETE', `/api/imports/${pending.id}`, {}).catch(() => undefined);
  pending = null;
  resumeId = null;
  void refresh();
});
$('[data-stop]').addEventListener('click', () => controller?.abort());

async function resume(id: string, sources: Map<string, Source>): Promise<void> {
  const state = await api<{ import: ImportView; files: ListingEntry[]; uploaded: { path: string; size: number }[] }>('GET', `/api/imports/${id}`);
  if (state.import.state !== 'uploading') {
    resumeId = null;
    planText.textContent = '';
    planError.textContent = 'This import is not waiting for files any more.';
    return;
  }
  // The server's list of what it already has is what makes this skip finished files.
  const plan = planUploads(state.files, state.uploaded, sources);
  if (plan.missing.length > 0) {
    planText.textContent = '';
    planError.textContent = `${plan.missing.length} files were not in what you chose, or have changed (${plan.missing.slice(0, 3).join(', ')}). Choose the same zips or folder as before.`;
    return;
  }
  resumeId = null;
  await upload(id, plan.todo, plan.doneBytes);
}

// ---- The imports list ----------------------------------------------------

const BUTTON_LABELS: Record<ImportAction, string> = { resume: 'Resume upload', cancel: 'Cancel', retry: 'Retry', remove: 'Remove' };

function row(s: ImportView): HTMLLIElement {
  const li = document.createElement('li');
  const title = document.createElement('strong');
  title.textContent = `${s.source === 'inbox' ? 'Inbox' : 'Upload'} · ${formatDate(s.createdAt)}`;
  const label = document.createElement('span');
  label.textContent = importLabel(s);
  li.append(title, label);
  if (s.failures.length > 0) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${s.failures.length} problems`;
    const ul = document.createElement('ul');
    for (const f of s.failures) {
      const item = document.createElement('li');
      item.textContent = `${f.path ?? f.postId ?? ''}: ${f.reason}`;
      ul.append(item);
    }
    details.append(summary, ul);
    li.append(details);
  }
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  for (const action of importActions(s)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = BUTTON_LABELS[action];
    button.addEventListener('click', () => void act(action, s.id, button));
    actions.append(button);
  }
  li.append(actions);
  return li;
}

async function act(action: ImportAction, id: string, button: HTMLButtonElement): Promise<void> {
  if (busy) return;
  if (action === 'resume') {
    resumeId = id;
    planBox.hidden = false;
    planError.textContent = '';
    planText.textContent = 'Choose or drop the same zips or folder again. Files already in the bucket are skipped.';
    $<HTMLButtonElement>('[data-upload]').disabled = true;
    return;
  }
  button.disabled = true;
  try {
    if (action === 'retry') await api('POST', `/api/imports/${id}/retry`, {});
    else await api('DELETE', `/api/imports/${id}`, {});
  } catch (error) {
    button.disabled = false;
    button.title = (error as Error).message;
    button.textContent = `${BUTTON_LABELS[action]} (failed: ${(error as Error).message})`;
    return;
  }
  void refresh();
}

let timer: number | undefined;
let refreshing = false;
let refreshAgain = false;
async function refresh(): Promise<void> {
  // One request and one timer at a time: a call during a poll is folded into one more refresh afterwards.
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  window.clearTimeout(timer);
  let active = false;
  try {
    const { imports } = await api<{ imports: ImportView[] }>('GET', '/api/imports');
    active = imports.some((s) => s.state === 'queued' || s.state === 'running');
    list.replaceChildren(...(imports.length > 0 ? imports.map(row) : [Object.assign(document.createElement('li'), { className: 'hint', textContent: 'No imports yet.' })]));
  } catch (error) {
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'error', textContent: (error as Error).message }));
  }
  refreshing = false;
  if (refreshAgain) {
    refreshAgain = false;
    return refresh();
  }
  timer = window.setTimeout(() => void refresh(), active ? 3000 : 30000);
}

$('[data-reindex]').addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  button.disabled = true;
  try {
    await api('POST', '/api/reindex', {});
  } catch (error) {
    button.title = (error as Error).message;
  } finally {
    button.disabled = false;
    void refresh();
  }
});

void refresh();
