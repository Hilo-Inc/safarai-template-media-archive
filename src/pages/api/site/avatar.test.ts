import { describe, expect, it } from 'vitest';
import { POST } from './avatar';

const call = (headers: Record<string, string>) =>
  POST({ request: new Request('http://x.test/api/site/avatar', { method: 'POST', headers, body: 'x' }) } as Parameters<typeof POST>[0]) as Promise<Response>;

describe('POST /api/site/avatar', () => {
  it('refuses a request without content-length', async () => {
    const res = await call({ 'content-type': 'multipart/form-data; boundary=b' });
    expect(res.status).toBe(411);
  });

  it('refuses an oversized one', async () => {
    const res = await call({ 'content-type': 'multipart/form-data; boundary=b', 'content-length': String(11 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });
});
