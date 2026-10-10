import type { Role } from './session';

const WRITE_TYPES = ['application/json', 'multipart/form-data'];

/**
 * Cross-site request protection for /api writes: the Origin's host must equal the Host header
 * (Coolify's proxy keeps Host; scheme is ignored because TLS ends at the proxy), and the body
 * must be JSON or multipart, which a plain cross-site HTML form cannot send with an Origin we accept.
 */
export function guardWrite(request: Request): string | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  let originHost: string | null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !host || originHost !== host) return 'cross-site request';
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!WRITE_TYPES.includes(type)) return 'unsupported content type';
  return null;
}

/** Where to go after login: a same-site path; never /admin for a viewer. */
export function safeNext(next: unknown, role: Role): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  if (role !== 'admin' && (next === '/admin' || next.startsWith('/admin/'))) return '/';
  return next;
}
