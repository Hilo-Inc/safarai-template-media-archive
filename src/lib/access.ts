import type { Visibility } from '../config/schema';
import type { Role } from './session';

export type Decision = 'allow' | 'login' | 'unauthorized' | 'forbidden';

const ALWAYS = new Set(['/login', '/api/login', '/api/logout', '/healthz']);

export function isApi(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

export function access(path: string, mode: Visibility, role: Role | null): Decision {
  if (ALWAYS.has(path) || path.startsWith('/_astro/')) return 'allow';
  const api = isApi(path);
  if (under(path, '/api/content')) {
    return mode === 'public' || role ? 'allow' : 'unauthorized';
  }
  if (api || under(path, '/admin')) {
    if (role === 'admin') return 'allow';
    if (api) return role ? 'forbidden' : 'unauthorized';
    return 'login';
  }
  return mode === 'public' || role ? 'allow' : 'login';
}
