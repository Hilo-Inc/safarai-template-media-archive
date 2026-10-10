import { describe, expect, it } from 'vitest';
import { importPathProblem, parseUploadKey } from './upload-key';

const ID = 'lx0abc12-0a1b2c';
const key = (path: string) => `imports/${ID}/${path}`;

describe('parseUploadKey', () => {
  it('accepts a normal path inside its own import', () => {
    expect(parseUploadKey(key('Camera/2024/a b.jpg'), ID)).toEqual({ ok: true, path: 'Camera/2024/a b.jpg' });
  });

  it.each([
    ['parent segment', key('../x.jpg')],
    ['parent segment deeper', key('a/../../_system/site.json')],
    ['dot segment', key('a/./b.jpg')],
    ['empty segment', key('a//b.jpg')],
    ['absolute path', `/${key('a.jpg')}`],
    ['backslash', key('a\\b.jpg')],
    ['control character', key('a\u0000.jpg')],
    ['newline', key('a\n.jpg')],
    ['no file', key('')],
    ['too long', key('a'.repeat(901))],
    ['another import', 'imports/lx0abc12-ffffff/a.jpg'],
    ['system key', '_system/site.json'],
    ['post JSON', 'posts/files_a.json'],
    ['no import id', 'imports/a.jpg'],
  ])('refuses %s', (_name, k) => {
    expect(parseUploadKey(k, ID).ok).toBe(false);
  });

  it('refuses keys inside denied folders', () => {
    for (const path of ['messages/inbox/a.jpg', 'export/personal_information/me.jpg', 'x/Connections/c.jpg', 'ads_information/a.jpg']) {
      expect(parseUploadKey(key(path), ID)).toEqual({ ok: false, reason: 'This folder is never uploaded' });
    }
  });

  it('names the problem with a path', () => {
    expect(importPathProblem('ok/a.jpg')).toBeNull();
    expect(importPathProblem('a/../b')).toBe('Bad file path');
  });
});
