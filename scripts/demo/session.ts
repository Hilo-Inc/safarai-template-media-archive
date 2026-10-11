import { SESSION_COOKIE } from '../../src/lib/session';

/** The session cookie as "name=value" from a login response's Set-Cookie headers (sent back by hand: it is Secure). */
export function sessionCookie(setCookies: string[]): string | null {
  return setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0] ?? null;
}
