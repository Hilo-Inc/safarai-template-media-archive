import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ both: false }));
vi.mock('../../env', async () => {
  const { parsePasswordHash } = await import('../../lib/password-hash');
  const HASH = 'pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0ODw$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY';
  const hashed = { kind: 'hash', value: HASH, hash: parsePasswordHash(HASH) };
  return {
    getEnv: () =>
      state.both
        ? { admin: hashed, viewer: hashed }
        : { admin: { kind: 'plain', value: 'admin-password-1' }, viewer: { kind: 'plain', value: 'viewer-password-1' } },
  };
});

const { POST } = await import('./login');
const { loginLimiter } = await import('../../lib/rate-limit');

function call(body: unknown, ip = '9.9.9.9') {
  const cookies: Record<string, { value: string; opts: Record<string, unknown> }> = {};
  const request = new Request('http://a.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `6.6.6.6, ${ip}` },
    body: JSON.stringify(body),
  });
  const ctx = {
    request,
    clientAddress: '127.0.0.1',
    cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => (cookies[name] = { value, opts }) },
  };
  return { response: POST(ctx as never) as Promise<Response>, cookies };
}

describe('POST /api/login', () => {
  beforeEach(() => loginLimiter().reset('9.9.9.9'));

  it('sets a secure session cookie for the admin password', async () => {
    const { response, cookies } = call({ password: 'admin-password-1', next: '/admin' });
    const res = await response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ next: '/admin' });
    expect(cookies.archive_session!.value).toMatch(/^admin\.\d+\./);
    expect(cookies.archive_session!.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  });

  it('refuses a wrong password without saying which one exists', async () => {
    const res = await call({ password: 'wrong' }).response;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Wrong password' });
  });

  it('blocks an address after 10 failures', async () => {
    for (let i = 0; i < 10; i++) await call({ password: 'wrong' }).response;
    const res = await call({ password: 'admin-password-1' }).response;
    expect(res.status).toBe(429);
  });

  it('refuses a password that opens both roles, and says how to fix it', async () => {
    state.both = true;
    try {
      const { response, cookies } = call({ password: 'correct horse battery staple' });
      const res = await response;
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'The admin and viewer passwords are the same. Change one of them before signing in.',
      });
      expect(cookies.archive_session).toBeUndefined();
    } finally {
      state.both = false;
    }
  });
});
