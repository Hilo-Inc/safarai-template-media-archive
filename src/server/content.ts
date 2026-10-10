import { loadConfig } from '../config/load';
import { defaultSigner, signJsonPaths, type UrlSigner } from '../lib/media-url';
import { readJson } from '../lib/json-cache';
import type { Role } from '../lib/session';
import { fail, json } from './http';

// posts/<id>.json, or any JSON under index/. No "." or ".." segments, no backslashes.
const ALLOWED = /^(posts\/[^/\\]+\.json|index\/(?:[^/\\]+\/)*[^/\\]+\.json)$/;

export interface ContentDeps {
  read: <T>(key: string) => Promise<T | null>;
  sign: UrlSigner;
  /** Kinds the site shows; posts of other kinds are for the admin only. Defaults to the configured kinds. */
  kinds?: readonly string[];
}

/** Bucket JSON for other clients and the browser, with media keys turned into usable URLs. */
export async function getContent(key: string, role: Role | null, deps: ContentDeps = { read: readJson, sign: defaultSigner() }): Promise<Response> {
  const kinds = deps.kinds ?? loadConfig().kinds;
  if (!ALLOWED.test(key) || key.split('/').some((s) => s === '.' || s === '..')) return fail(404, 'Not found');
  const value = await deps.read<Record<string, unknown>>(key);
  if (!value) return fail(404, 'Not found');
  if (key.startsWith('posts/') && role !== 'admin' && (value.hidden === true || !kinds.includes(value.kind as string))) return fail(404, 'Not found');
  return json(200, await signJsonPaths(value, deps.sign), { 'cache-control': 'private, max-age=60' });
}
