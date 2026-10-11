import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config/load';
import { EnvError, readEnv } from './env';
import { parsePasswordHash } from './lib/password-hash';

const base = {
  S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'sfr-abc',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret-value',
  ADMIN_PASSWORD: 'admin-password-123',
};
const SALT = 'AAECAwQFBgcICQoLDA0ODw';
const HASH = `pbkdf2-sha256$600000$${SALT}$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY`; // 'correct horse battery staple'
const { ADMIN_PASSWORD: _plain, ...noAdmin } = base;
const pub = resolveConfig({}, {});
const pw = resolveConfig({ visibility: 'password' }, {});

describe('readEnv', () => {
  it('reads S3 settings and the public media address', () => {
    const env = readEnv({ ...base, MEDIA_PUBLIC_URL: 'https://shop-media.example.com/' }, pub);
    expect(env.s3).toEqual({
      endpoint: base.S3_ENDPOINT,
      region: 'auto',
      bucket: 'sfr-abc',
      accessKeyId: 'key',
      secretAccessKey: 'secret-value',
      forcePathStyle: false,
    });
    expect(env.mediaPublicUrl).toBe('https://shop-media.example.com');
    expect(env.viewer).toBeNull();
  });

  it('defaults the region and reads path-style addressing', () => {
    const env = readEnv({ ...base, S3_REGION: '', S3_FORCE_PATH_STYLE: '1' }, pub);
    expect(env.s3.region).toBe('auto');
    expect(env.s3.forcePathStyle).toBe(true);
  });

  it('names a missing variable', () => {
    expect(() => readEnv({ ...base, S3_BUCKET: '' }, pub)).toThrow(new EnvError('S3_BUCKET is not set'));
  });

  it('rejects a short admin password without printing it', () => {
    let message = '';
    try {
      readEnv({ ...base, ADMIN_PASSWORD: 'short-pw' }, pub);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('ADMIN_PASSWORD must be at least 12 characters');
    expect(message).not.toContain('short-pw');
  });

  it('needs a distinct viewer password in password mode and ignores the media address there', () => {
    expect(() => readEnv(base, pw)).toThrow(
      'VIEWER_PASSWORD or VIEWER_PASSWORD_HASH is required when visibility is password',
    );
    expect(() => readEnv({ ...base, VIEWER_PASSWORD: base.ADMIN_PASSWORD }, pw)).toThrow(
      'VIEWER_PASSWORD must differ from ADMIN_PASSWORD',
    );
    const env = readEnv({ ...base, VIEWER_PASSWORD: 'viewer-password-1', MEDIA_PUBLIC_URL: 'https://m.example.com' }, pw);
    expect(env.viewer).toEqual({ kind: 'plain', value: 'viewer-password-1' });
    expect(env.mediaPublicUrl).toBeNull();
  });

  it('rejects a media address that is not http(s)', () => {
    expect(() => readEnv({ ...base, MEDIA_PUBLIC_URL: 'ftp://x' }, pub)).toThrow('MEDIA_PUBLIC_URL must be an http(s) address');
  });

  it('takes the site address from SITE_URL, else the first COOLIFY_URL', () => {
    expect(readEnv({ ...base, SITE_URL: 'https://archive.example.com/' }, pub).siteUrl).toBe('https://archive.example.com');
    expect(readEnv({ ...base, COOLIFY_URL: 'https://a.example.com,https://b.example.com' }, pub).siteUrl).toBe('https://a.example.com');
    expect(readEnv(base, pub).siteUrl).toBeNull();
  });
});

describe('readEnv passwords', () => {
  it('reads a plain admin password as today', () => {
    expect(readEnv(base, pub).admin).toEqual({ kind: 'plain', value: 'admin-password-123' });
  });

  it('prefers ADMIN_PASSWORD_HASH over ADMIN_PASSWORD', () => {
    expect(readEnv({ ...base, ADMIN_PASSWORD_HASH: HASH }, pub).admin).toEqual({
      kind: 'hash',
      value: HASH,
      hash: parsePasswordHash(HASH),
    });
  });

  it('trims a pasted hash', () => {
    expect(readEnv({ ...noAdmin, ADMIN_PASSWORD_HASH: `  ${HASH}\n` }, pub).admin).toMatchObject({ kind: 'hash', value: HASH });
  });

  it('needs one admin credential', () => {
    expect(() => readEnv(noAdmin, pub)).toThrow(new EnvError('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is required'));
  });

  it('names a malformed hash without echoing it', () => {
    expect(() => readEnv({ ...base, ADMIN_PASSWORD_HASH: 'not-a-hash-value' }, pub)).toThrow(
      new EnvError('ADMIN_PASSWORD_HASH is not a valid password hash')
    );
  });

  it('does not apply the length rule to hashes', () => {
    expect(readEnv({ ...noAdmin, ADMIN_PASSWORD_HASH: HASH, ADMIN_PASSWORD: 'short' }, pub).admin.kind).toBe('hash');
  });

  it('needs one viewer credential in password mode', () => {
    expect(() => readEnv(base, pw)).toThrow(
      new EnvError('VIEWER_PASSWORD or VIEWER_PASSWORD_HASH is required when visibility is password')
    );
    expect(readEnv({ ...base, VIEWER_PASSWORD_HASH: HASH }, pw).viewer).toMatchObject({ kind: 'hash', value: HASH });
  });

  it('ignores viewer credentials when public', () => {
    expect(readEnv({ ...base, VIEWER_PASSWORD_HASH: 'malformed' }, pub).viewer).toBeNull();
  });

  it('refuses a plain viewer password that matches the admin hash', () => {
    expect(() =>
      readEnv({ ...noAdmin, ADMIN_PASSWORD_HASH: HASH, VIEWER_PASSWORD: 'correct horse battery staple' }, pw)
    ).toThrow(new EnvError('VIEWER_PASSWORD must differ from ADMIN_PASSWORD_HASH'));
  });

  it('refuses a viewer hash that the plain admin password matches', () => {
    expect(() =>
      readEnv({ ...base, ADMIN_PASSWORD: 'correct horse battery staple', VIEWER_PASSWORD_HASH: HASH }, pw)
    ).toThrow(new EnvError('VIEWER_PASSWORD_HASH must differ from ADMIN_PASSWORD'));
  });

  it('accepts two hashes, which cannot be compared at start', () => {
    expect(readEnv({ ...noAdmin, ADMIN_PASSWORD_HASH: HASH, VIEWER_PASSWORD_HASH: HASH }, pw).viewer?.kind).toBe('hash');
  });
});
