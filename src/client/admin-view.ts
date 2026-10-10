import type { ListingEntry } from '../importers/types';
import type { ImportStatus } from '../indexer/status';
import { formatBytes } from '../render/format';
import type { AdminSummary } from '../schema/index-types';

export type ImportView = Omit<ImportStatus, 'doneIds'>;
export type ImportAction = 'resume' | 'cancel' | 'retry' | 'remove';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function importActions(s: ImportView): ImportAction[] {
  switch (s.state) {
    case 'uploading':
      return s.source === 'upload' ? ['resume', 'cancel'] : ['cancel'];
    case 'queued':
    case 'running':
      return [];
    case 'failed':
      return ['retry', 'remove'];
    case 'done':
      return s.posts.failed > 0 ? ['retry', 'remove'] : ['remove'];
  }
}

export function importLabel(s: ImportView): string {
  const { total, done, failed, skipped } = s.posts;
  switch (s.state) {
    case 'uploading':
      return `Waiting for files: ${plural(s.files, 'file')}, ${formatBytes(s.bytes)}`;
    case 'queued':
      return 'Waiting to start';
    case 'running':
      return total === 0 ? 'Reading the files' : `Processing: ${done + failed + skipped} of ${total} posts`;
    case 'failed':
      return `Failed: ${s.error ?? 'unknown error'}`;
    case 'done': {
      const parts = [plural(done, 'post')];
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} already imported`);
      return `Done: ${parts.join(', ')}`;
    }
  }
}

export function selectionSummary(selected: ListingEntry[], listed: number): string {
  const bytes = selected.reduce((n, e) => n + e.size, 0);
  const others = listed - selected.length;
  const head = `${plural(selected.length, 'file')}, ${formatBytes(bytes)} to upload.`;
  return others > 0 ? `${head} ${plural(others, 'other file')} stay on your computer.` : head;
}

export interface PostFilter {
  text: string;
  show: 'all' | 'visible' | 'hidden' | 'featured';
}

export function filterPosts<T extends Pick<AdminSummary, 'id' | 'caption' | 'hidden' | 'featured'>>(posts: T[], filter: PostFilter): T[] {
  const text = filter.text.trim().toLowerCase();
  return posts.filter((p) => {
    if (filter.show === 'hidden' && !p.hidden) return false;
    if (filter.show === 'visible' && p.hidden) return false;
    if (filter.show === 'featured' && !p.featured) return false;
    return !text || p.id.toLowerCase().includes(text) || p.caption.toLowerCase().includes(text);
  });
}

export type LinkRow = { label: string; url: string };

/** The site-links form rows as the server accepts them: filled rows only, http(s) addresses only. */
export function cleanLinks(rows: LinkRow[]): { ok: true; links: LinkRow[] } | { ok: false; error: string } {
  const links: LinkRow[] = [];
  for (const row of rows) {
    const label = row.label.trim();
    const url = row.url.trim();
    if (!label && !url) continue;
    if (!label || !url) return { ok: false, error: `Each link needs a label and an address: ${label || url}` };
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: `Links must start with http:// or https://: ${label}` };
    links.push({ label, url });
  }
  return { ok: true, links };
}
