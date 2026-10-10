import { defineMiddleware } from 'astro:middleware';
import { loadConfig } from './config/load';
import { access, isApi, normalizePath } from './lib/access';
import { guardWrite } from './lib/request-guard';
import { SESSION_COOKIE, sessionSecret, verifySession } from './lib/session';

/** Early refusals are private too: never cached, never indexed. */
function lock(response: Response): Response {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

const json = (status: number, error: string) =>
  lock(new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } }));

export const onRequest = defineMiddleware(async (context, next) => {
  const { search } = context.url;
  const pathname = normalizePath(context.url.pathname);
  const mode = loadConfig().visibility;

  if (isApi(pathname)) {
    const refusal = guardWrite(context.request);
    if (refusal) return json(403, refusal);
  }

  const role = verifySession(context.cookies.get(SESSION_COOKIE)?.value, sessionSecret());
  context.locals.role = role;

  const decision = access(pathname, mode, role);
  if (decision === 'unauthorized') return json(401, 'Sign in first');
  if (decision === 'forbidden') return json(403, 'Only the owner can do this');
  if (decision === 'login') return lock(context.redirect(`/login?next=${encodeURIComponent(pathname + search)}`, 303));

  const response = await next();
  if (mode === 'password') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (!response.headers.has('cache-control')) response.headers.set('Cache-Control', 'private, no-store');
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/login') {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
});
