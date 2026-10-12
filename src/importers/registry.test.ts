import { describe, expect, it } from 'vitest';
import { memoryFiles } from '../../test/helpers/memory-files';
import { chooseImporter, getImporter } from './registry';

describe('registry', () => {
  it('finds importers by name', () => {
    expect(getImporter('generic')?.name).toBe('generic');
    expect(getImporter('instagram')?.name).toBe('instagram');
  });

  it('sends Instagram JSON exports to instagram and refuses Facebook and Instagram HTML exports', () => {
    const chosenIg = chooseImporter(memoryFiles({ 'your_instagram_activity/media/posts_1.json': '[]' }));
    expect(chosenIg.ok && chosenIg.importer.name).toBe('instagram');
    expect(chooseImporter(memoryFiles({ 'your_facebook_activity/posts/x.json': '[]' }))).toEqual({ ok: false, reason: expect.stringContaining('Instagram or Facebook export') });
    expect(chooseImporter(memoryFiles({ 'your_instagram_activity/media/posts_1.html': '' }))).toEqual({ ok: false, reason: expect.stringContaining('HTML version') });
    expect(chooseImporter(memoryFiles({ 'messages/inbox/a/message_1.json': '{}' }))).toEqual({ ok: false, reason: expect.stringContaining('Instagram or Facebook export') });
    const chosen = chooseImporter(memoryFiles({ 'a.mp4': { size: 1 } }));
    expect(chosen.ok && chosen.importer.name).toBe('generic');
  });
});
