import type { APIRoute } from 'astro';
import { getQueue } from '../../indexer/queue';
import { store } from '../../lib/store';
import { reindex } from '../../server/imports';

export const POST: APIRoute = () => reindex(store(), getQueue());
