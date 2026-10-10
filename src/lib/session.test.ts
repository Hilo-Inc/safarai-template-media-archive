import { describe, expect, it } from 'vitest';
import { checkPassword, deriveSecret, SESSION_TTL_MS, signSession, verifySession } from './session';

const env = { adminPassword: 'admin-password-1', viewerPassword: 'viewer-password-1' };
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
    expect(verifySession(value, deriveSecret({ ...env, adminPassword: 'changed-password' }), 1)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession('a.b', secret)).toBeNull();
    expect(verifySession('owner.99999999999999.x', secret)).toBeNull();
  });

  it('prefers an explicit secret', () => {
    expect(deriveSecret(env, 'explicit').equals(deriveSecret({ ...env, adminPassword: 'x' }, 'explicit'))).toBe(true);
  });
});

describe('checkPassword', () => {
  it('returns the matching role', () => {
    expect(checkPassword('admin-password-1', env)).toBe('admin');
    expect(checkPassword('viewer-password-1', env)).toBe('viewer');
    expect(checkPassword('nope', env)).toBeNull();
    expect(checkPassword('', { ...env, viewerPassword: null })).toBeNull();
  });
});
