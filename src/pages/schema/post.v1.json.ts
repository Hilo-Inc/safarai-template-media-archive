import type { APIRoute } from 'astro';
import { postJsonSchema } from '../../schema/post';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(postJsonSchema(), null, 2), {
    headers: { 'content-type': 'application/schema+json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
