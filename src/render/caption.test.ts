import { describe, expect, it } from 'vitest';
import { captionParts, firstLine, profileUrl } from './caption';

const parts = (text: string, mentions: 'text' | 'link' = 'text', platform = 'instagram') => captionParts(text, { platform, mentions });

describe('captionParts', () => {
  it('links hashtags to their tag page, lower-cased', () => {
    expect(parts('Sun #Summer!')).toEqual([
      { type: 'text', text: 'Sun ' },
      { type: 'tag', text: '#Summer', href: '/tags/summer' },
      { type: 'text', text: '!' },
    ]);
  });

  it('keeps emoji and non-Latin tags', () => {
    expect(parts('🌊 #café')).toEqual([
      { type: 'text', text: '🌊 ' },
      { type: 'tag', text: '#café', href: `/tags/${encodeURIComponent('café')}` },
    ]);
  });

  it('leaves mentions as text by default', () => {
    expect(parts('with @friend.one')).toEqual([
      { type: 'text', text: 'with ' },
      { type: 'mention', text: '@friend.one', href: null },
    ]);
  });

  it('links mentions to the platform profile when configured', () => {
    expect(parts('with @friend.one', 'link')[1]).toEqual({ type: 'mention', text: '@friend.one', href: 'https://www.instagram.com/friend.one/' });
    expect(parts('hi @a', 'link', 'files')[1]).toEqual({ type: 'mention', text: '@a', href: null });
  });

  it('does not treat an e-mail address as a mention', () => {
    expect(parts('mail me@example.com')).toEqual([{ type: 'text', text: 'mail me@example.com' }]);
  });

  it('links http and https URLs only', () => {
    expect(parts('see https://example.com/a?b=1. ok')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'url', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', text: '. ok' },
    ]);
    expect(parts('javascript:alert(1)')).toEqual([{ type: 'text', text: 'javascript:alert(1)' }]);
  });

  it('never makes a link of any other scheme', () => {
    const hostile =
      'javascript:alert(1) data:text/html,<b>x</b> JAVASCRIPT://x vbscript:x ftp://h/f file:///etc/passwd //evil.com (javascript:void(0))';
    const result = parts(hostile);
    expect(result.filter((p) => p.type === 'url')).toEqual([]);
    // nothing is dropped: the caption is still all there as text
    expect(result.map((p) => p.text).join('')).toBe(hostile);
  });

  it('every url part is http or https', () => {
    const urls = parts('a http://a.com b https://b.com/x c HTTPS://c.com').filter((p) => p.type === 'url');
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.href).toMatch(/^https?:\/\//);
  });

  it('a javascript: scheme inside an https URL stays part of that https link', () => {
    expect(parts('https://example.com/javascript:alert')[0]).toMatchObject({ type: 'url', href: 'https://example.com/javascript:alert' });
  });

  it('returns nothing for an empty caption', () => {
    expect(parts('')).toEqual([]);
  });
});

describe('profileUrl', () => {
  it('knows the platforms the presets cover', () => {
    expect(profileUrl('tiktok', 'a_b')).toBe('https://www.tiktok.com/@a_b');
    expect(profileUrl('youtube', 'a')).toBe('https://www.youtube.com/@a');
    expect(profileUrl('soundcloud', 'a')).toBe('https://soundcloud.com/a');
    expect(profileUrl('facebook', 'a.b')).toBe('https://www.facebook.com/a.b');
    expect(profileUrl('files', 'a')).toBeNull();
  });

  it('encodes the handle so it cannot leave the path', () => {
    expect(profileUrl('instagram', 'a/../b?x=1#y')).toBe('https://www.instagram.com/a%2F..%2Fb%3Fx%3D1%23y/');
    expect(profileUrl('tiktok', 'a b')).toBe('https://www.tiktok.com/@a%20b');
    expect(profileUrl('soundcloud', '../admin')).toBe('https://soundcloud.com/..%2Fadmin');
  });
});

describe('firstLine', () => {
  it('takes the first non-empty line and cuts it by characters', () => {
    expect(firstLine('\n  Hello there\nsecond', 80)).toBe('Hello there');
    expect(firstLine('🌊🌊🌊🌊', 3)).toBe('🌊🌊…');
    expect(firstLine('', 10)).toBe('');
  });
});
