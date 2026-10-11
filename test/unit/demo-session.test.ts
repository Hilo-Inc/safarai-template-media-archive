import { describe, expect, it } from 'vitest';
import { sessionCookie } from '../../scripts/demo/session';

describe('sessionCookie', () => {
  it('returns "name=value" of the session cookie, or null', () => {
    expect(sessionCookie(['other=1; Path=/', 'archive_session=abc.def; Path=/; HttpOnly; Secure; SameSite=Lax'])).toBe('archive_session=abc.def');
    expect(sessionCookie(['other=1'])).toBeNull();
    expect(sessionCookie([])).toBeNull();
  });
});
