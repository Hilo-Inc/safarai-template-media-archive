import { describe, expect, it } from 'vitest';
import { memoryFiles } from '../../test/helpers/memory-files';
import { chooseImporter, getImporter } from './registry';

describe('registry', () => {
  it('finds importers by name', () => {
    expect(getImporter('generic')?.name).toBe('generic');
    expect(getImporter('instagram')).toBeNull();
  });

  it('refuses Meta exports before any importer sees them', () => {
    expect(chooseImporter(memoryFiles({ 'your_instagram_activity/media/posts_1.json': '[]' }))).toEqual({
      ok: false,
      reason: expect.stringContaining('Instagram or Facebook export'),
    });
    const chosen = chooseImporter(memoryFiles({ 'a.mp4': { size: 1 } }));
    expect(chosen.ok && chosen.importer.name).toBe('generic');
  });
});
