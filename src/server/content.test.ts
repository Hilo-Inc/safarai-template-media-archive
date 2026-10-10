import { describe, expect, it } from 'vitest';
import { getContent } from './content';

const posts: Record<string, unknown> = {
  'posts/files_a.json': { id: 'files_a', kind: 'post', hidden: false, media: [] },
  'posts/files_h.json': { id: 'files_h', kind: 'post', hidden: true, media: [] },
  'posts/files_t.json': { id: 'files_t', kind: 'track', hidden: false, media: [] },
};
const deps = (kinds: string[]) => ({
  read: async <T,>(key: string) => (posts[key] ?? null) as T | null,
  sign: async (src: string) => src,
  kinds,
});

describe('getContent', () => {
  it('hides posts of excluded kinds from non-admins, like the post page does', async () => {
    const d = deps(['post']);
    expect((await getContent('posts/files_t.json', 'viewer', d)).status).toBe(404);
    expect((await getContent('posts/files_t.json', null, d)).status).toBe(404);
    expect((await getContent('posts/files_t.json', 'admin', d)).status).toBe(200);
    expect((await getContent('posts/files_a.json', 'viewer', d)).status).toBe(200);
  });

  it('hides hidden posts from non-admins', async () => {
    const d = deps(['post']);
    expect((await getContent('posts/files_h.json', 'viewer', d)).status).toBe(404);
    expect((await getContent('posts/files_h.json', 'admin', d)).status).toBe(200);
  });
});
