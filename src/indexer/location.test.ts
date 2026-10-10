import { describe, expect, it } from 'vitest';
import { applyLocation } from './location';

const full = { lat: 48.858_37, lng: 2.294_48, name: 'Tower' };

describe('applyLocation', () => {
  it('drops everything with none', () => {
    expect(applyLocation(full, 'none')).toBeNull();
  });
  it('keeps only the name with place', () => {
    expect(applyLocation(full, 'place')).toEqual({ name: 'Tower' });
    expect(applyLocation({ lat: 1, lng: 2 }, 'place')).toBeNull();
  });
  it('rounds coordinates to about 1 km with rounded', () => {
    expect(applyLocation(full, 'rounded')).toEqual({ lat: 48.86, lng: 2.29, name: 'Tower' });
    expect(applyLocation({ name: 'Cafe' }, 'rounded')).toEqual({ name: 'Cafe' });
  });
  it('keeps coordinates with exact, and nothing else', () => {
    expect(applyLocation({ ...full, device_id: 'abc' } as never, 'exact')).toEqual(full);
    expect(applyLocation(null, 'exact')).toBeNull();
  });
});
