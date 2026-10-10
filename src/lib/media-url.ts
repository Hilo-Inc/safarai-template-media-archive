import { loadConfig } from '../config/load';
import { getEnv } from '../env';
import { encodeKey } from './keys';
import { store } from './store';

export type UrlSigner = (src: string) => Promise<string>;

const PRESIGN_SECONDS = 3600;

export function urlSigner(publicBase: string | null, presign: (key: string) => Promise<string>): UrlSigner {
  if (publicBase) return async (src) => `${publicBase}/${encodeKey(src)}`;
  return presign;
}

/** Public mode with a media domain: plain URLs. Otherwise (password mode, or no domain): presigned GETs valid 1 hour. */
export function defaultSigner(): UrlSigner {
  const base = loadConfig().visibility === 'public' ? getEnv().mediaPublicUrl : null;
  return urlSigner(base, (key) => store().presignGet(key, PRESIGN_SECONDS));
}

export function mediaUrl(src: string): Promise<string> {
  return defaultSigner()(src);
}

const URL_KEYS = new Set(['src', 'peaks']);

/** Returns a copy of a post/index JSON value with every bucket key in `src` and `peaks` turned into a URL. */
export async function signJsonPaths<T>(value: T, sign: UrlSigner): Promise<T> {
  if (Array.isArray(value)) return (await Promise.all(value.map((v) => signJsonPaths(v, sign)))) as T;
  if (value === null || typeof value !== 'object') return value;
  const entries = await Promise.all(
    Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [
      k,
      URL_KEYS.has(k) && typeof v === 'string' ? await sign(v) : await signJsonPaths(v, sign),
    ]),
  );
  return Object.fromEntries(entries) as T;
}
