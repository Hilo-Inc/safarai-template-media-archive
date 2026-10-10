/** The visitor's address behind Cloudflare and Coolify's proxy. Only used as a rate-limit key. */
export function clientIp(headers: Headers, fallback: string | undefined): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return fallback || 'unknown';
}
