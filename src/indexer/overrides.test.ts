import { describe, expect, it } from 'vitest';
import { makePost } from '../../test/fixtures/posts';
import { applyOverrides, postPatchSchema } from './overrides';

const post = makePost('files_a', '2025-01-01T00:00:00.000Z', { location: { lat: 1.23, lng: 4.56, name: 'Old' } });

describe('applyOverrides', () => {
  it('sets hidden and featured from the lists', () => {
    expect(applyOverrides(post, { hidden: ['files_a'], featured: [], edits: {} })).toMatchObject({ hidden: true, featured: false });
    expect(applyOverrides({ ...post, hidden: true }, { hidden: [], featured: ['files_a'], edits: {} })).toMatchObject({ hidden: false, featured: true });
  });

  it('applies caption, alt text and place edits', () => {
    const out = applyOverrides(post, { hidden: [], featured: [], edits: { files_a: { caption: 'New words', alt: { '0': 'A beach' }, place: 'Harbour' } } });
    expect(out.caption).toBe('New words');
    expect(out.media[0]).toMatchObject({ alt: 'A beach' });
    expect(out.location).toEqual({ lat: 1.23, lng: 4.56, name: 'Harbour' });
  });

  it('removes only the place name when it is cleared', () => {
    const out = applyOverrides(post, { hidden: [], featured: [], edits: { files_a: { place: null } } });
    expect(out.location).toEqual({ lat: 1.23, lng: 4.56 });
  });

  it('accepts only known fields within limits', () => {
    expect(postPatchSchema.safeParse({ hidden: true, extra: 1 }).success).toBe(false);
    expect(postPatchSchema.safeParse({ caption: 'x'.repeat(5001) }).success).toBe(false);
    expect(postPatchSchema.safeParse({ alt: { first: 'x' } }).success).toBe(false);
    expect(postPatchSchema.safeParse({ featured: true, alt: { '2': null } }).success).toBe(true);
  });
});
