import type { APIRoute } from 'astro';
import { getQueue } from '../../indexer/queue';
import { store } from '../../lib/store';
import { readJsonBody } from '../../server/http';
import { updateSite } from '../../server/site';

export const PUT: APIRoute = async ({ request }) => updateSite(store(), getQueue(), await readJsonBody(request));
