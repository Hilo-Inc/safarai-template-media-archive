import type { ArchiveConfig } from './config/schema';
import { loadConfig } from './config/load';
import { shared } from './lib/shared';

export interface ServerEnv {
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
  /** Public media base URL without a trailing slash; null in password mode or when unset. */
  mediaPublicUrl: string | null;
  adminPassword: string;
  viewerPassword: string | null;
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

export function readEnv(env: Env, config: ArchiveConfig): ServerEnv {
  const adminPassword = required(env, 'ADMIN_PASSWORD');
  if (adminPassword.length < MIN_PASSWORD) throw new EnvError(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters`);

  let viewerPassword: string | null = null;
  if (config.visibility === 'password') {
    viewerPassword = env.VIEWER_PASSWORD?.trim() || null;
    if (!viewerPassword) throw new EnvError('VIEWER_PASSWORD is required when visibility is password');
    if (viewerPassword.length < MIN_PASSWORD) throw new EnvError(`VIEWER_PASSWORD must be at least ${MIN_PASSWORD} characters`);
    if (viewerPassword === adminPassword) throw new EnvError('VIEWER_PASSWORD must differ from ADMIN_PASSWORD');
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
    adminPassword,
    viewerPassword,
    siteUrl: site ? httpOrigin(site, env.SITE_URL ? 'SITE_URL' : 'COOLIFY_URL') : null,
  };
}

export function getEnv(): ServerEnv {
  return shared('env', () => readEnv(process.env, loadConfig()));
}
