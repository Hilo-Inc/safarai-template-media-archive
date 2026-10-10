import type { APIRoute } from 'astro';
import { store } from '../../../lib/store';
import { fail } from '../../../server/http';
import { MAX_AVATAR_BYTES, uploadAvatar } from '../../../server/site';

export const POST: APIRoute = async ({ request }) => {
  // Refuse oversized bodies before buffering them; the multipart overhead is small.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_AVATAR_BYTES + 64 * 1024) return fail(413, 'The image must be 10 MB or smaller');
  const form = await request.formData().catch(() => null);
  return form ? uploadAvatar(store(), form) : fail(400, 'Choose an image');
};
