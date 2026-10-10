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

describe('safeNext open-redirect hardening', () => {
  it('rejects control characters, whitespace and backslashes', () => {
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ /evil.example', '//evil.example', '/\\evil.example', '/\u0000x', '/\u0085/evil.example']) {
      expect(safeNext(bad, 'admin')).toBe('/');
    }
  });
  it('keeps path, query and hash', () => {
    expect(safeNext('/p/abc?x=1#y', 'viewer')).toBe('/p/abc?x=1#y');
  });
  it('still keeps viewers out of admin after normalisation', () => {
    expect(safeNext('/admin?x=1', 'viewer')).toBe('/');
  });
});

describe('safeNext dot-segment and encoding tricks', () => {
  it('falls back when resolution yields a protocol-relative path', () => {
    for (const bad of ['/.//evil.example', '/a/..//evil.example', '/%2e//evil.example', '/%2e%2e//evil.example', '/%5Cevil.example', '/%E0%A4%A']) {
      expect(safeNext(bad, 'admin')).toBe('/');
    }
  });
  it('judges encoded admin paths for viewers', () => {
    expect(safeNext('/%61dmin', 'viewer')).toBe('/');
    expect(safeNext('/%61dmin/x', 'viewer')).toBe('/');
    expect(safeNext('/%61dmin', 'admin')).toBe('/%61dmin');
  });
});

describe('safeNext decoded dot segments', () => {
  it('keeps viewers out of admin', () => {
    expect(safeNext('/%2e%2e%2fadmin', 'viewer')).toBe('/');
    expect(safeNext('/foo%2f..%2fadmin', 'viewer')).toBe('/');
  });
});
