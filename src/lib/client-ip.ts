/**
 * The visitor's address behind Coolify's Traefik, which appends the real peer to X-Forwarded-For.
 * Earlier entries (and cf-connecting-ip) are client-controlled, so only the right-most entry is trusted.
 * Only used as a rate-limit key.
 */
export function clientIp(headers: Headers, fallback: string | undefined): string {
  const entries = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const last = entries?.[entries.length - 1];
  if (last) return last;
  return fallback || 'unknown';
}
