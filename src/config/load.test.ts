import { describe, expect, it } from 'vitest';
import { ConfigError, resolveConfig } from './load';
import { KINDS } from './schema';

describe('resolveConfig', () => {
  it('fills defaults from an empty file', () => {
    expect(resolveConfig({}, {})).toEqual({
      preset: 'generic',
      visibility: 'public',
      kinds: [...KINDS],
      exclude: ['archived', 'deleted', 'draft'],
      location: 'none',
      mentions: 'text',
    });
  });

  it('takes kinds from the preset when they are not set', () => {
    expect(resolveConfig({ preset: 'tiktok' }, {}).kinds).toEqual(['video']);
    expect(resolveConfig({ preset: 'instagram' }, {}).kinds).toEqual(['post', 'reel', 'story', 'igtv']);
    expect(resolveConfig({ preset: 'instagram', kinds: ['post'] }, {}).kinds).toEqual(['post']);
  });

  it('lets environment variables override the file', () => {
    const c = resolveConfig(
      { visibility: 'public', location: 'none' },
      { SITE_VISIBILITY: 'password', ARCHIVE_KINDS: 'video, short', ARCHIVE_LOCATION: 'rounded', ARCHIVE_PRESET: 'youtube', ARCHIVE_MENTIONS: 'link' },
    );
    expect(c).toMatchObject({ visibility: 'password', kinds: ['video', 'short'], location: 'rounded', preset: 'youtube', mentions: 'link' });
  });

  it('ignores empty environment values', () => {
    expect(resolveConfig({ preset: 'tiktok' }, { ARCHIVE_PRESET: '', SITE_VISIBILITY: '  ' })).toMatchObject({ preset: 'tiktok', visibility: 'public' });
  });

  it('names the key, its variable and the allowed values for an invalid value', () => {
    expect(() => resolveConfig({}, { SITE_VISIBILITY: 'open' })).toThrow(ConfigError);
    expect(() => resolveConfig({}, { SITE_VISIBILITY: 'open' })).toThrow(
      'archive.config.json "visibility" (or SITE_VISIBILITY) must be one of: public, password',
    );
    expect(() => resolveConfig({}, { ARCHIVE_KINDS: 'video,clips' })).toThrow(
      '"kinds" (or ARCHIVE_KINDS) must be one of: post, reel, story, igtv, video, short, track',
    );
    expect(() => resolveConfig({ preset: 'myspace' }, {})).toThrow('"preset" (or ARCHIVE_PRESET) must be one of:');
  });

  it('rejects unknown keys and an edited exclude list', () => {
    expect(() => resolveConfig({ colour: 'red' }, {})).toThrow('unknown key "colour"');
    expect(() => resolveConfig({ exclude: ['archived'] }, {})).toThrow('"exclude" is fixed and must list archived, deleted, draft');
  });

  it('rejects a file that is not an object', () => {
    expect(() => resolveConfig([], {})).toThrow('archive.config.json must be a JSON object');
  });
});
