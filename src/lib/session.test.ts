import { describe, expect, it } from 'vitest';
import { parsePasswordHash } from './password-hash';
import { checkPassword, deriveSecret, SESSION_TTL_MS, signSession, verifySession } from './session';

const plain = (value: string) => ({ kind: 'plain' as const, value });
const env = { admin: plain('admin-password-1'), viewer: plain('viewer-password-1') };
const secret = deriveSecret(env);

describe('session cookie', () => {
  it('round-trips a role', () => {
    expect(verifySession(signSession('admin', secret, 1000), secret, 2000)).toBe('admin');
    expect(verifySession(signSession('viewer', secret, 1000), secret, 2000)).toBe('viewer');
  });

  it('expires after 14 days', () => {
    const value = signSession('viewer', secret, 0);
    expect(verifySession(value, secret, SESSION_TTL_MS - 1)).toBe('viewer');
    expect(verifySession(value, secret, SESSION_TTL_MS + 1)).toBeNull();
  });

  it('rejects tampering, other secrets and junk', () => {
    const value = signSession('viewer', secret, 0);
    expect(verifySession(value.replace('viewer', 'admin'), secret, 1)).toBeNull();
    expect(verifySession(value, deriveSecret({ ...env, admin: plain('changed-password') }), 1)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession('a.b', secret)).toBeNull();
    expect(verifySession('owner.99999999999999.x', secret)).toBeNull();
  });

  it('prefers an explicit secret', () => {
    expect(deriveSecret(env, 'explicit').equals(deriveSecret({ ...env, admin: plain('x') }, 'explicit'))).toBe(true);
  });
});

describe('checkPassword', () => {
  it('returns the matching role', async () => {
    expect(await checkPassword('admin-password-1', env)).toBe('admin');
    expect(await checkPassword('viewer-password-1', env)).toBe('viewer');
    expect(await checkPassword('nope', env)).toBeNull();
    expect(await checkPassword('', { ...env, viewer: null })).toBeNull();
  });
});

describe('key derivation', () => {
  it('is scrypt, not a plain sha-256 of the passwords', async () => {
    const { createHash } = await import('node:crypto');
    const old = createHash('sha256').update(`media-archive-session\0${env.admin.value}\0${env.viewer.value}`).digest();
    expect(secret.length).toBe(32);
    expect(secret.equals(old)).toBe(false);
  });
  it('is deterministic and changes with the admin password, invalidating cookies', () => {
    expect(deriveSecret(env).equals(secret)).toBe(true);
    const other = deriveSecret({ ...env, admin: plain('another-admin-pw') });
    expect(other.equals(secret)).toBe(false);
    expect(verifySession(signSession('admin', secret, 0), other, 1)).toBeNull();
  });
});

const HASH = 'pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0ODw$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY';
const hashed = (value: string) => ({ kind: 'hash' as const, value, hash: parsePasswordHash(value)! });

describe('checkPassword with hashes', () => {
  it('signs in as admin with the password of an admin hash', async () => {
    expect(await checkPassword('correct horse battery staple', { admin: hashed(HASH), viewer: null })).toBe('admin');
  });

  it('signs in as viewer with the password of a viewer hash', async () => {
    expect(await checkPassword('correct horse battery staple', { admin: plain('admin-password-1'), viewer: hashed(HASH) })).toBe('viewer');
  });

  it("reports 'both' when one password opens both roles", async () => {
    expect(await checkPassword('correct horse battery staple', { admin: hashed(HASH), viewer: hashed(HASH) })).toBe('both');
  });

  it('rejects a wrong password', async () => {
    expect(await checkPassword('correct horse battery stapler', { admin: hashed(HASH), viewer: null })).toBeNull();
  });
});

describe('deriveSecret with hashes', () => {
  it('changes when a hash changes', () => {
    const other = 'pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0ODw$uItD2LEIk3VCFQeA8KteV8qxESPX_gqQ1ASzK1ilxF8';
    expect(deriveSecret({ admin: hashed(HASH), viewer: null }).equals(deriveSecret({ admin: hashed(other), viewer: null }))).toBe(false);
  });
});
