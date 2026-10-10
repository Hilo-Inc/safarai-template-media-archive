import { describe, expect, it } from 'vitest';
import { guardWrite, safeNext } from './request-guard';

const req = (headers: Record<string, string>, method = 'POST') =>
  new Request('http://archive.example.com/api/imports', { method, headers });

describe('guardWrite', () => {
  it('allows same-host JSON and multipart writes', () => {
    expect(guardWrite(req({ host: 'archive.example.com', origin: 'https://archive.example.com', 'content-type': 'application/json' }))).toBeNull();
    expect(
      guardWrite(req({ host: 'archive.example.com', origin: 'https://archive.example.com', 'content-type': 'multipart/form-data; boundary=x' })),
    ).toBeNull();
  });

  it('ignores reads', () => {
    expect(guardWrite(req({}, 'GET'))).toBeNull();
  });

  it('refuses cross-site, origin-less and form-encoded writes', () => {
    expect(guardWrite(req({ host: 'archive.example.com', origin: 'https://evil.example', 'content-type': 'application/json' }))).toBe('cross-site request');
    expect(guardWrite(req({ host: 'archive.example.com', 'content-type': 'application/json' }))).toBe('cross-site request');
    expect(
      guardWrite(req({ host: 'archive.example.com', origin: 'https://archive.example.com', 'content-type': 'application/x-www-form-urlencoded' })),
    ).toBe('unsupported content type');
  });
});

describe('safeNext', () => {
  it('keeps same-site paths and sends viewers away from admin', () => {
    expect(safeNext('/p/files_a', 'viewer')).toBe('/p/files_a');
    expect(safeNext('//evil.example', 'admin')).toBe('/');
    expect(safeNext('https://evil.example', 'admin')).toBe('/');
    expect(safeNext('/\\evil.example', 'admin')).toBe('/');
    expect(safeNext('/admin', 'viewer')).toBe('/');
    expect(safeNext('/admin', 'admin')).toBe('/admin');
    expect(safeNext(undefined, 'admin')).toBe('/');
  });
});
