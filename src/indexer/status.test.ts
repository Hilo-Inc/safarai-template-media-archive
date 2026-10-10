import { describe, expect, it } from 'vitest';
import type { Store } from '../lib/store';
import { addFailure, IMPORT_ID_RE, listStatuses, MAX_FAILURES, newImportId, newStatus, readStatus } from './status';

describe('import status', () => {
  it('makes sortable, unguessable ids', () => {
    const a = newImportId(1_700_000_000_000);
    expect(a).toMatch(IMPORT_ID_RE);
    expect(a.startsWith((1_700_000_000_000).toString(36))).toBe(true);
    expect(newImportId()).not.toBe(newImportId());
    expect(IMPORT_ID_RE.test('../x')).toBe(false);
  });

  it('starts empty and caps the failure list but not the count', () => {
    const s = newStatus({ id: newImportId(), importer: 'generic', source: 'upload', files: 3, bytes: 30 }, new Date('2026-10-10T00:00:00.000Z'));
    expect(s).toMatchObject({ state: 'uploading', createdAt: '2026-10-10T00:00:00.000Z', posts: { total: 0, done: 0, failed: 0, skipped: 0 }, doneIds: [], failures: [], error: null });
    for (let i = 0; i < MAX_FAILURES + 5; i++) addFailure(s, { postId: `files_${i}`, path: null, reason: 'x' });
    expect(s.failures).toHaveLength(MAX_FAILURES);
    expect(s.posts.failed).toBe(MAX_FAILURES + 5);
  });

  describe('unreadable status files', () => {
    const good = newStatus({ id: 'lx0abc12-0a1b2c', importer: 'generic', source: 'upload', files: 1, bytes: 1 }, new Date('2026-10-10T00:00:00.000Z'));
    const bad = 'lx0abc13-0a1b2d';
    const store = {
      list: async () => [good.id, bad].map((id) => ({ key: `_system/imports/${id}.json`, size: 1 })),
      getJson: async (key: string) => {
        if (key.includes(bad)) throw new SyntaxError('Unexpected token');
        return good;
      },
    } as unknown as Store;

    it('lists a corrupt file as a failed import that can be removed, instead of throwing', async () => {
      const list = await listStatuses(store);
      expect(list.map((s) => s.id)).toEqual([good.id, bad]);
      expect(list[1]).toMatchObject({ state: 'failed', error: 'Status file unreadable' });
    });

    it('reads a corrupt file as that same failed import', async () => {
      expect(await readStatus(store, bad)).toMatchObject({ id: bad, state: 'failed', error: 'Status file unreadable' });
    });

    it('still throws for store errors', async () => {
      const broken = { list: store.list, getJson: async () => { throw new Error('connect ECONNREFUSED'); } } as unknown as Store;
      await expect(listStatuses(broken)).rejects.toThrow('ECONNREFUSED');
    });
  });
});
