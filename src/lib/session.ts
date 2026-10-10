import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../env';
import { shared } from './shared';

export type Role = 'admin' | 'viewer';
export const SESSION_COOKIE = 'archive_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Passwords = { adminPassword: string; viewerPassword: string | null };

/** SESSION_SECRET when set; otherwise derived from both passwords, so changing a password signs everyone out. */
export function deriveSecret(env: Passwords, explicit?: string): Buffer {
  const material = explicit || `media-archive-session\0${env.adminPassword}\0${env.viewerPassword ?? ''}`;
  // scrypt makes guessing the admin password offline from a viewer's cookie expensive.
  return scryptSync(material, 'safarai-media-archive/session/v1', 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

export function sessionSecret(): Buffer {
  return shared('session-secret', () => deriveSecret(getEnv(), process.env.SESSION_SECRET?.trim()));
}

function mac(payload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function same(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export function signSession(role: Role, secret: Buffer, now = Date.now()): string {
  const payload = `${role}.${now + SESSION_TTL_MS}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function verifySession(value: string | undefined, secret: Buffer, now = Date.now()): Role | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [role, expires, sig] = parts as [string, string, string];
  if (role !== 'admin' && role !== 'viewer') return null;
  if (!same(sig, mac(`${role}.${expires}`, secret))) return null;
  if (!/^\d+$/.test(expires) || Number(expires) < now) return null;
  return role;
}

export function checkPassword(given: string, env: Passwords): Role | null {
  if (!given) return null;
  const admin = same(given, env.adminPassword);
  const viewer = env.viewerPassword !== null && same(given, env.viewerPassword);
  return admin ? 'admin' : viewer ? 'viewer' : null;
}
