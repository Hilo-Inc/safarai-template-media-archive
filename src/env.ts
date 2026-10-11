import type { ArchiveConfig } from './config/schema';
import { loadConfig } from './config/load';
import { parsePasswordHash, verifyPasswordSync, type PasswordHash } from './lib/password-hash';
import { shared } from './lib/shared';

export interface ServerEnv {
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
  /** Public media base URL without a trailing slash; null in password mode or when unset. */
  mediaPublicUrl: string | null;
  admin: Credential;
  /** Set in password mode only. */
  viewer: Credential | null;
  /** The site's own address for feed links; null when unknown. */
  siteUrl: string | null;
}

/** Messages name the variable, never its value. */
export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

type Env = Record<string, string | undefined>;
const MIN_PASSWORD = 12;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new EnvError(`${name} is not set`);
  return value;
}

function httpOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnvError(`${name} must be an http(s) address`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new EnvError(`${name} must be an http(s) address`);
  return url.href.replace(/\/+$/, '');
}

/** A sign-in password: set as plain text (self-hosting) or as a hash (Safarai). */
export type Credential = { kind: 'plain'; value: string } | { kind: 'hash'; value: string; hash: PasswordHash };

type Role = 'ADMIN_PASSWORD' | 'VIEWER_PASSWORD';

/** `<name>_HASH` wins over `<name>`; null when neither is set. */
function credential(env: Env, name: Role): Credential | null {
  const hashed = env[`${name}_HASH`]?.trim();
  if (hashed) {
    const hash = parsePasswordHash(hashed);
    if (!hash) throw new EnvError(`${name}_HASH is not a valid password hash`);
    return { kind: 'hash', value: hashed, hash };
  }
  const plain = env[name]?.trim();
  if (!plain) return null;
  if (plain.length < MIN_PASSWORD) throw new EnvError(`${name} must be at least ${MIN_PASSWORD} characters`);
  return { kind: 'plain', value: plain };
}

const variable = (name: Role, c: Credential) => (c.kind === 'hash' ? `${name}_HASH` : name);

/** Whether both accept the same password. Two hashes can't be compared; sign-in refuses that case instead. */
function samePassword(a: Credential, b: Credential): boolean {
  if (a.kind === 'plain' && b.kind === 'plain') return a.value === b.value;
  if (a.kind === 'hash' && b.kind === 'hash') return false;
  const [plain, hashed] = a.kind === 'plain' ? [a, b] : [b, a];
  return hashed.kind === 'hash' && verifyPasswordSync(plain.value, hashed.hash);
}

export function readEnv(env: Env, config: ArchiveConfig): ServerEnv {
  const admin = credential(env, 'ADMIN_PASSWORD');
  if (!admin) throw new EnvError('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is required');

  let viewer: Credential | null = null;
  if (config.visibility === 'password') {
    viewer = credential(env, 'VIEWER_PASSWORD');
    if (!viewer) throw new EnvError('VIEWER_PASSWORD or VIEWER_PASSWORD_HASH is required when visibility is password');
    if (samePassword(admin, viewer)) {
      throw new EnvError(`${variable('VIEWER_PASSWORD', viewer)} must differ from ${variable('ADMIN_PASSWORD', admin)}`);
    }
  }

  const media = env.MEDIA_PUBLIC_URL?.trim();
  const mediaPublicUrl = media && config.visibility === 'public' ? httpOrigin(media, 'MEDIA_PUBLIC_URL') : null;

  const site = env.SITE_URL?.trim() || env.COOLIFY_URL?.split(',')[0]?.trim();
  return {
    s3: {
      endpoint: required(env, 'S3_ENDPOINT'),
      region: env.S3_REGION?.trim() || 'auto',
      bucket: required(env, 'S3_BUCKET'),
      accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === '1' || env.S3_FORCE_PATH_STYLE === 'true',
    },
    mediaPublicUrl,
    admin,
    viewer,
    siteUrl: site ? httpOrigin(site, env.SITE_URL ? 'SITE_URL' : 'COOLIFY_URL') : null,
  };
}

export function getEnv(): ServerEnv {
  return shared('env', () => readEnv(process.env, loadConfig()));
}
