import type { APIRoute } from 'astro';
import { getEnv } from '../../env';
import { clientIp } from '../../lib/client-ip';
import { loginLimiter } from '../../lib/rate-limit';
import { safeNext } from '../../lib/request-guard';
import { checkPassword, SESSION_COOKIE, SESSION_TTL_MS, sessionSecret, signSession } from '../../lib/session';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const ip = clientIp(request.headers, clientAddress);
  const limiter = loginLimiter();
  if (limiter.blocked(ip)) return json(429, { error: 'Too many attempts. Try again in 15 minutes.' });

  const body = (await request.json().catch(() => ({}))) as { password?: unknown; next?: unknown };
  const result = typeof body.password === 'string' ? await checkPassword(body.password, getEnv()) : null;
  // The password is right, so this is not a failed attempt; the owner has to change one of the two.
  if (result === 'both') {
    return json(409, { error: 'The admin and viewer passwords are the same. Change one of them before signing in.' });
  }
  if (!result) {
    limiter.fail(ip);
    return json(401, { error: 'Wrong password' });
  }
  const role = result;
  limiter.reset(ip);
  cookies.set(SESSION_COOKIE, signSession(role, sessionSecret()), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return json(200, { next: safeNext(body.next, role) });
};
