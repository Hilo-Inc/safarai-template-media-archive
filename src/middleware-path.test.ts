import { describe, expect, it } from 'vitest';
import { access, normalizePath } from './lib/access';

describe('normalizePath', () => {
  it('collapses repeated slashes so access judges the real path', () => {
    expect(normalizePath('//admin')).toBe('/admin');
    expect(normalizePath('/admin///posts')).toBe('/admin/posts');
    expect(normalizePath('/')).toBe('/');
    expect(access(normalizePath('//admin')!, 'public', null)).toBe('login');
    expect(access(normalizePath('//api//imports')!, 'public', null)).toBe('unauthorized');
  });
  it('decodes percent-escapes before collapsing', () => {
    expect(normalizePath('/%61dmin')).toBe('/admin');
    expect(normalizePath('/%2Fadmin')).toBe('/admin');
    expect(access(normalizePath('/%61dmin')!, 'public', null)).toBe('login');
  });
  it('rejects malformed escapes', () => {
    expect(normalizePath('/%E0%A4%A')).toBeNull();
  });
});
