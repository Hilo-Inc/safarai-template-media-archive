import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config/load';
import { EnvError, readEnv } from './env';

const base = {
  S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'sfr-abc',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret-value',
  ADMIN_PASSWORD: 'admin-password-123',
};
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
    expect(env.viewerPassword).toBeNull();
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
    expect(() => readEnv(base, pw)).toThrow('VIEWER_PASSWORD is required when visibility is password');
    expect(() => readEnv({ ...base, VIEWER_PASSWORD: base.ADMIN_PASSWORD }, pw)).toThrow(
      'VIEWER_PASSWORD must differ from ADMIN_PASSWORD',
    );
    const env = readEnv({ ...base, VIEWER_PASSWORD: 'viewer-password-1', MEDIA_PUBLIC_URL: 'https://m.example.com' }, pw);
    expect(env.viewerPassword).toBe('viewer-password-1');
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
