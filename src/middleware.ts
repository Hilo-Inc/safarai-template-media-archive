import { defineMiddleware } from 'astro:middleware';
import { loadConfig } from './config/load';
import { access, isApi } from './lib/access';
import { guardWrite } from './lib/request-guard';
import { SESSION_COOKIE, sessionSecret, verifySession } from './lib/session';

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
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
  if (decision === 'login') return context.redirect(`/login?next=${encodeURIComponent(pathname + search)}`, 303);

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
