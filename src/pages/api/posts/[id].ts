import type { APIRoute } from 'astro';
import { getQueue } from '../../../indexer/queue';
import { store } from '../../../lib/store';
import { readJsonBody } from '../../../server/http';
import { patchPost } from '../../../server/posts';

export const PATCH: APIRoute = async ({ params, request }) => patchPost(store(), getQueue(), params.id ?? '', await readJsonBody(request));
