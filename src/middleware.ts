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
  if (pathname === null) return json(400, 'Bad request');
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
  if (decision === 'login') return lock(context.redirect(`/login?next=${encodeURIComponent(context.url.pathname + search)}`, 303));

  const response = await next();
  if (mode === 'password') response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Everything a signed-in admin sees, and everything in password mode, is private whatever the route set (the schema route says
  // "public"; an admin sees hidden posts that a shared cache must never keep). Public assets are the only exception.
  const isAsset = pathname.startsWith('/_astro/');
  if (!isAsset && (mode === 'password' || role === 'admin' || pathname === '/login' || pathname === '/admin' || pathname.startsWith('/admin/'))) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
});
