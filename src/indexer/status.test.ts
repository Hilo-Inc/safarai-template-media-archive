import { describe, expect, it } from 'vitest';
import { addFailure, IMPORT_ID_RE, MAX_FAILURES, newImportId, newStatus } from './status';

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
});
