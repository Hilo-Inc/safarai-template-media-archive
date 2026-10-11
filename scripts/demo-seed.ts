// Fills the local demo with generated placeholder posts, through the app's own import: files go into the bucket's
// inbox, then the admin API re-indexes, sets the profile and pins a post. Runs in the demo-seed container.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { demoCatalog } from './demo/catalog';
import { avatarPng, renderPost } from './demo/render';
import { sessionCookie } from './demo/session';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const app = env('DEMO_APP_URL');
const bucket = env('S3_BUCKET');
const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT'),
  region: env('S3_REGION'),
  forcePathStyle: true,
  credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
});
const SITE = {
  title: 'Demo Archive',
  bio: 'Landscapes, small trips and the odd sound recording.\nPlaceholder posts for trying the template.',
  links: [
    { label: 'Website', url: 'https://example.com' },
    { label: 'Newsletter', url: 'https://example.org/newsletter' },
  ],
};

async function hasPosts(): Promise<boolean> {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'posts/', MaxKeys: 1 }));
  return (res.KeyCount ?? 0) > 0;
}

async function login(): Promise<string> {
  const res = await fetch(`${app}/api/login`, {
    method: 'POST',
    headers: { origin: app, 'content-type': 'application/json' },
    body: JSON.stringify({ password: env('ADMIN_PASSWORD') }),
  });
  const cookie = sessionCookie(res.headers.getSetCookie());
  if (!res.ok || !cookie) throw new Error(`Sign-in failed: ${res.status}`);
  return cookie;
}

async function call(cookie: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { origin: app, cookie };
  let payload: string | ArrayBuffer | undefined;
  if (body instanceof FormData) {
    // Serialise the form first so the request has a Content-Length (the avatar route refuses chunked bodies).
    const req = new Request(`${app}${path}`, { method, body });
    headers['content-type'] = req.headers.get('content-type')!;
    payload = await req.arrayBuffer();
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${app}${path}`, { method, headers, body: payload, redirect: 'manual' });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function waitForImport(cookie: string, id: string): Promise<string> {
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const { import: status } = (await call(cookie, 'GET', `/api/imports/${id}`)) as { import: { state: string } };
    if (status.state === 'done' || status.state === 'failed') return status.state;
    if (Date.now() > deadline) throw new Error('The import did not finish within 15 minutes');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function printReady(): void {
  console.log('\nThe demo is ready: http://localhost:3000');
  console.log(`To try the admin, sign in at http://localhost:3000/login with the demo password: ${env('ADMIN_PASSWORD')}`);
  console.log('Stop it and delete the demo content with: npm run demo:down');
}

async function main(): Promise<void> {
  if (await hasPosts()) {
    printReady();
    return;
  }
  const posts = demoCatalog();
  const dir = await mkdtemp(join(tmpdir(), 'demo-'));
  try {
    console.log(`Generating ${posts.length} placeholder posts…`);
    for (const post of posts) {
      for (const name of await renderPost(post, dir)) {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `inbox/${name}`, Body: await readFile(join(dir, name)) }));
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const cookie = await login();
  const { id } = (await call(cookie, 'POST', '/api/reindex', {})) as { id: string | null };
  if (!id) throw new Error('The re-index found no files in the inbox');
  console.log('Importing (a minute or two)…');
  const state = await waitForImport(cookie, id);
  if (state !== 'done') throw new Error(`The import ended as "${state}"; see the demo-app logs`);
  await call(cookie, 'PUT', '/api/site', SITE);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await avatarPng())], { type: 'image/png' }), 'avatar.png');
  await call(cookie, 'POST', '/api/site/avatar', form);
  for (const post of posts.filter((p) => p.featured)) await call(cookie, 'PATCH', `/api/posts/demo_${post.shortcode}`, { featured: true });
  printReady();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
