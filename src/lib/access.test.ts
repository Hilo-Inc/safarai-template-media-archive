import { describe, expect, it } from 'vitest';
import { access } from './access';

describe('access', () => {
  const cases: [string, 'public' | 'password', 'admin' | 'viewer' | null, string][] = [
    ['/login', 'password', null, 'allow'],
    ['/api/login', 'password', null, 'allow'],
    ['/api/logout', 'password', null, 'allow'],
    ['/healthz', 'password', null, 'allow'],
    ['/_astro/app.js', 'password', null, 'allow'],
    ['/', 'public', null, 'allow'],
    ['/p/files_a', 'public', null, 'allow'],
    ['/fragments/post/files_a', 'public', null, 'allow'],
    ['/fragments/post/files_a', 'password', null, 'login'],
    ['/fragments/post/files_a', 'password', 'viewer', 'allow'],
    ['/', 'password', null, 'login'],
    ['/feed.json', 'password', null, 'login'],
    ['/', 'password', 'viewer', 'allow'],
    ['/api/content/posts/files_a.json', 'public', null, 'allow'],
    ['/api/content/posts/files_a.json', 'password', null, 'unauthorized'],
    ['/api/content/posts/files_a.json', 'password', 'viewer', 'allow'],
    ['/admin', 'public', null, 'login'],
    ['/admin/posts', 'public', 'viewer', 'login'],
    ['/admin', 'password', 'admin', 'allow'],
    ['/administrator', 'public', null, 'allow'],
    ['/api/imports', 'public', null, 'unauthorized'],
    ['/api/imports', 'password', 'viewer', 'forbidden'],
    ['/api/imports', 'public', 'admin', 'allow'],
    ['/api/uploads/sign', 'public', null, 'unauthorized'],
  ];
  it.each(cases)('%s in %s mode as %s → %s', (path, mode, role, expected) => {
    expect(access(path, mode, role)).toBe(expected);
  });
});
