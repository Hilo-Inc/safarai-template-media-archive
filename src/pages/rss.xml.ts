import type { APIRoute } from 'astro';
import { loadConfig } from '../config/load';
import { keys } from '../lib/keys';
import { store } from '../lib/store';

/** The bucket copy written by the index build; public mode only. */
export const GET: APIRoute = async () => {
  if (loadConfig().visibility !== 'public') return new Response('Not found', { status: 404 });
  const text = await store().getText(keys.rss);
  if (text === null) return new Response('Not found', { status: 404 });
  return new Response(text, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
};
