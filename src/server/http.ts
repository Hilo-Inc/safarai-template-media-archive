import type { z } from 'zod';

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function fail(status: number, message: string): Response {
  return json(status, { error: message });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

/** Parses a request body; on failure returns a 400 naming the first problem. */
export function parseWith<S extends z.ZodType>(schema: S, body: unknown): { ok: true; data: z.output<S> } | { ok: false; response: Response } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0]!;
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return { ok: false, response: fail(400, `${where}${issue.message}`) };
}
