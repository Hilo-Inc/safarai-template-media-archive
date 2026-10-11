import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { getEnv, type Credential } from '../env';
import { verifyPassword } from './password-hash';
import { shared } from './shared';

export type Role = 'admin' | 'viewer';
export const SESSION_COOKIE = 'archive_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Credentials = { admin: Credential; viewer: Credential | null };

/** SESSION_SECRET when set; otherwise derived from both credentials, so changing a password signs everyone out. */
export function deriveSecret(env: Credentials, explicit?: string): Buffer {
  // For plain passwords this is the same material as before hashes existed: sessions survive the upgrade.
  const material = explicit || `media-archive-session\0${env.admin.value}\0${env.viewer?.value ?? ''}`;
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

function matches(given: string, credential: Credential): Promise<boolean> | boolean {
  return credential.kind === 'plain' ? same(given, credential.value) : verifyPassword(given, credential.hash);
}

/**
 * The role a password signs in as. 'both' when it opens both roles, which
 * only two hashes can do (equal plain passwords are refused at start).
 */
export async function checkPassword(given: string, env: Credentials): Promise<Role | 'both' | null> {
  if (!given) return null;
  const [admin, viewer] = await Promise.all([matches(given, env.admin), env.viewer ? matches(given, env.viewer) : false]);
  if (admin && viewer) return 'both';
  return admin ? 'admin' : viewer ? 'viewer' : null;
}
