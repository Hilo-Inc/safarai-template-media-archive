import { OverrideError, postPatchSchema, updatePost } from '../indexer/overrides';
import type { Store } from '../lib/store';
import { POST_ID_RE } from '../schema/post';
import { fail, json, parseWith } from './http';
import type { QueueLike } from './imports';

export async function patchPost(store: Store, queue: QueueLike, id: string, body: unknown): Promise<Response> {
  if (!POST_ID_RE.test(id) || id.length > 120) return fail(404, 'No such post');
  const parsed = parseWith(postPatchSchema, body);
  if (!parsed.ok) return parsed.response;
  try {
    const post = await updatePost(store, id, parsed.data);
    void queue.requestRebuild();
    return json(200, { post });
  } catch (error) {
    if (error instanceof OverrideError) return fail(error.status, error.message);
    // e.g. unreadable overrides: log the reason for the operator, tell the owner generically.
    console.error('patchPost failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return fail(500, 'Could not save the change');
  }
}
