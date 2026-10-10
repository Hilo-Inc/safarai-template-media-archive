// The access model rests on the middleware judging the same path that Astro's router serves. These tests start the BUILT
// server and send raw request paths (node:http does not normalise them), so an Astro or adapter upgrade that changes
// decoding, case handling or trailing slashes fails here instead of silently opening /admin or /api/*.
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keys } from '../../src/lib/keys';
import { Store } from '../../src/lib/store';
import { makePost } from '../fixtures/posts';

const ADMIN_PASSWORD = 'admin-password-for-tests';
const VIEWER_PASSWORD = 'viewer-password-for-tests';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function raw(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

interface Running {
  port: number;
  child: ChildProcess;
  log: () => string;
}

async function start(mode: 'public' | 'password'): Promise<Running> {
  const port = await freePort();
  const child = spawn('node', ['dist/start.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      SITE_VISIBILITY: mode,
      ADMIN_PASSWORD,
      VIEWER_PASSWORD: mode === 'password' ? VIEWER_PASSWORD : '',
      MEDIA_PUBLIC_URL: '',
      SITE_URL: `http://127.0.0.1:${port}`,
      S3_FORCE_PATH_STYLE: '1',
      ARCHIVE_PRESET: '',
      ARCHIVE_KINDS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (c: Buffer) => (output += c));
  child.stderr?.on('data', (c: Buffer) => (output += c));
  let exited = false;
  child.on('exit', () => (exited = true));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error(`The server exited while starting:\n${output}`);
    try {
      if ((await raw(port, 'GET', '/healthz')).status === 200) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`The server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { port, child, log: () => output };
}

async function stop(server: Running): Promise<void> {
  if (server.child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.child.once('exit', () => resolve());
    server.child.kill();
  });
}

/** The session cookie as "name=value", read from Set-Cookie (the cookie is Secure, so it is sent by hand over http). */
async function login(server: Running, password: string): Promise<string> {
  const origin = `http://127.0.0.1:${server.port}`;
  const res = await raw(server.port, 'POST', '/api/login', { origin, host: `127.0.0.1:${server.port}`, 'content-type': 'application/json' }, JSON.stringify({ password }));
  expect(res.status).toBe(200);
  const cookie = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('archive_session='));
  expect(cookie).toBeTruthy();
  return cookie!.split(';')[0]!;
}

const ADMIN_PATHS = [
  '/admin', '/admin/', '//admin', '///admin', '/./admin', '/x/../admin', '/x/%2e%2e/admin', '/%2e%2e/admin', '/%2e/admin', '/%61dmin',
  '/admin/.', '/admin/./posts', '/admin/posts/', '/admin%5cposts', '/admin\\posts', '/admin%00',
  '/%2fadmin', '/%2Fadmin', '/admin%2fposts', '/admin%2Fposts', '/admin%2f', '/admin/posts%2f', '/admin/posts%3fx',
  '/ADMIN', '/Admin', '/ADMIN/posts', '/Admin/posts',
  '/admin%3f', '/admin%3F', '/admin%23', '/admin;x', '/admin%3bx',
  '/admin/site', '/admin/export-guide',
];

const API_GETS = [
  '/api/imports', '/api%2fimports', '//api/imports', '/./api/imports', '/api/imports/', '/api/imports%3f', '/api/imports%23', '/API/imports', '/Api/Imports',
  '/api/site', '/api/posts/x', '/api/imports/lx0abc12-0a1b2c',
];
const API_WRITES: [string, string][] = [
  ['POST', '/api/imports'], ['POST', '/api%2fimports'], ['POST', '/api/reindex'], ['POST', '/api%2freindex'], ['POST', '/API/reindex'],
  ['PUT', '/api/site'], ['POST', '/api/site'], ['PATCH', '/api/posts/x'], ['POST', '/api/posts/x'], ['DELETE', '/api/imports/lx0abc12-0a1b2c'],
  ['POST', '/api/imports/lx0abc12-0a1b2c/start'], ['POST', '/api/imports/lx0abc12-0a1b2c/sign'], ['POST', '/api/site/avatar'],
];
const CONTENT_PROBES = [
  '/api/content/_system/site.json', '/api/content/index/%2e%2e/_system/site.json', '/api/content/index/..%2f_system%2fsite.json',
  '/api/content/posts/..%2f_system%2fsite.json', '/api/content/%2e%2e/_system/site.json', '/api/content/feed.json',
];

const NOT_REACHED = [303, 401, 403, 404, 405];

function expectRefused(reply: Reply, path: string): void {
  expect(reply.status, `${path} answered ${reply.status}`).toSatisfy((s: number) => NOT_REACHED.includes(s));
  if (reply.status === 303) expect(String(reply.headers.location), path).toMatch(/^\/login(\?|$)/);
}

let store: Store;
const seeded = [keys.site, keys.post('files_hidden')];
let builtOk = false;

beforeAll(async () => {
  await promisify(execFile)('npm', ['run', 'build'], { cwd: process.cwd(), shell: true, maxBuffer: 64 * 1024 * 1024 });
  builtOk = true;
  store = new Store({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET!,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'test',
    forcePathStyle: true,
  });
  await store.putJson(keys.site, { title: 'SECRET-SITE-TITLE' });
  await store.putJson(keys.post('files_hidden'), makePost('files_hidden', '2025-01-01T00:00:00.000Z', { hidden: true }));
}, 600_000);

afterAll(async () => {
  if (builtOk) await store.deleteKeys(seeded);
});

describe.each(['public', 'password'] as const)('routing in %s mode', (mode) => {
  let server: Running;
  let admin: string;
  let viewer: string | null = null;

  beforeAll(async () => {
    server = await start(mode);
    admin = await login(server, ADMIN_PASSWORD);
    if (mode === 'password') viewer = await login(server, VIEWER_PASSWORD);
  });
  afterAll(async () => {
    if (server) await stop(server);
  });

  const origin = () => ({ origin: `http://127.0.0.1:${server.port}`, host: `127.0.0.1:${server.port}`, 'content-type': 'application/json' });
  const get = (path: string, cookie?: string) => raw(server.port, 'GET', path, cookie ? { cookie } : {});

  it('sanity: the admin cookie reaches the admin pages and API (so the refusals below are not vacuous)', async () => {
    expect((await get('/admin', admin)).status).toBe(200);
    expect((await get('/admin/posts', admin)).status).toBe(200);
    expect((await get('/api/imports', admin)).status).toBe(200);
    expect((await get('/api/content/posts/files_hidden.json', admin)).status).toBe(200);
  });

  it('refuses every admin path variant to anonymous visitors', async () => {
    for (const path of ADMIN_PATHS) expectRefused(await get(path), path);
  });

  it('refuses every admin path variant to viewers', async () => {
    if (!viewer) return;
    for (const path of ADMIN_PATHS) expectRefused(await get(path, viewer), path);
  });

  it('refuses the admin API to anonymous visitors and viewers, for reads and writes', async () => {
    for (const cookie of [undefined, ...(viewer ? [viewer] : [])]) {
      const headers = { ...origin(), ...(cookie ? { cookie } : {}) };
      for (const path of API_GETS) expectRefused(await raw(server.port, 'GET', path, cookie ? { cookie } : {}), path);
      for (const [method, path] of API_WRITES) expectRefused(await raw(server.port, method, path, headers, '{}'), `${method} ${path}`);
    }
  });

  it('never serves _system/ through the content API', async () => {
    for (const cookie of [undefined, admin, ...(viewer ? [viewer] : [])]) {
      for (const path of CONTENT_PROBES) {
        const reply = await get(path, cookie);
        expect(reply.body, path).not.toContain('SECRET-SITE-TITLE');
        // Paths that resolve outside /api/content fall to the admin API's own refusal (401/403); inside it, 404.
        expect([400, 401, 403, 404, 303], `${path} answered ${reply.status}`).toContain(reply.status);
      }
    }
  });

  it('keeps hidden posts away from non-admins, and private for the admin', async () => {
    const anon = mode === 'public' ? [undefined] : [];
    for (const cookie of [...anon, ...(viewer ? [viewer] : [])]) {
      expect((await get('/api/content/posts/files_hidden.json', cookie)).status).toBe(404);
      expect((await get('/p/files_hidden', cookie)).status).toBe(404);
    }
    const page = await get('/p/files_hidden', admin);
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('private, no-store');
  });

  it('serves the JSON schema privately in password mode', async () => {
    const res = await get('/schema/post.v1.json', viewer ?? undefined);
    expect(res.status).toBe(200);
    if (mode === 'password') expect(res.headers['cache-control']).toBe('private, no-store');
    else expect(res.headers['cache-control']).toContain('public');
  });

  it('does not log secrets', () => {
    for (const secret of [ADMIN_PASSWORD, VIEWER_PASSWORD, process.env.S3_SECRET_ACCESS_KEY ?? 'test-secret-never']) {
      expect(server.log()).not.toContain(secret);
    }
  });
});

describe('what the page head says', () => {
  let publicServer: Running;
  let passwordServer: Running;
  let viewer: string;

  beforeAll(async () => {
    publicServer = await start('public');
    passwordServer = await start('password');
    viewer = await login(passwordServer, VIEWER_PASSWORD);
  });
  afterAll(async () => {
    await Promise.all([publicServer && stop(publicServer), passwordServer && stop(passwordServer)]);
  });

  it('public mode: home, kind and tag pages carry Open Graph tags and are not noindex', async () => {
    for (const path of ['/', '/kind/post', '/tags/summer']) {
      const page = await raw(publicServer.port, 'GET', path);
      expect(page.body, path).toContain('property="og:title"');
      expect(page.headers['x-robots-tag'], path).toBeUndefined();
    }
  });

  it('password mode: noindex everywhere and no Open Graph tags', async () => {
    for (const path of ['/', '/kind/post', '/tags/summer']) {
      const page = await raw(passwordServer.port, 'GET', path, { cookie: viewer });
      expect(page.headers['x-robots-tag'], path).toBe('noindex, nofollow');
      expect(page.body, path).toContain('name="robots" content="noindex, nofollow"');
      expect(page.body, path).not.toContain('og:');
    }
    const anonymous = await raw(passwordServer.port, 'GET', '/');
    expect(anonymous.status).toBe(303);
    expect(anonymous.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
