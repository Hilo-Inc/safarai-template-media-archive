import { pbkdf2, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Passwords stored as "pbkdf2-sha256$<iterations>$<salt>$<hash>" (base64url,
 * no padding), as Safarai's launch form makes them in the browser.
 */
export interface PasswordHash {
  iterations: number;
  salt: Buffer;
  key: Buffer;
}

const FORMAT = /^pbkdf2-sha256\$(\d{6,8})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const KEY_LENGTH = 32;
const pbkdf2Async = promisify(pbkdf2);

/** The parts of a hash string, or null when it is malformed. */
export function parsePasswordHash(value: string): PasswordHash | null {
  const match = FORMAT.exec(value);
  if (!match) return null;
  const [, rounds, salt64, key64] = match as unknown as [string, string, string, string];
  const iterations = Number(rounds);
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;
  const salt = Buffer.from(salt64, 'base64url');
  const key = Buffer.from(key64, 'base64url');
  // The last character can carry unused bits: only the canonical spelling counts.
  if (salt.toString('base64url') !== salt64 || key.toString('base64url') !== key64) return null;
  return { iterations, salt, key };
}

// The same password typed on different devices can arrive composed or decomposed.
const normal = (password: string) => password.normalize('NFC');

export async function verifyPassword(password: string, hash: PasswordHash): Promise<boolean> {
  const key = await pbkdf2Async(normal(password), hash.salt, hash.iterations, KEY_LENGTH, 'sha256');
  return timingSafeEqual(key, hash.key);
}

/** For the one start-up check that compares a plain password with a hash. */
export function verifyPasswordSync(password: string, hash: PasswordHash): boolean {
  return timingSafeEqual(pbkdf2Sync(normal(password), hash.salt, hash.iterations, KEY_LENGTH, 'sha256'), hash.key);
}
