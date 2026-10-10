import type { APIRoute } from 'astro';
import { getQueue } from '../../../../indexer/queue';
import { store } from '../../../../lib/store';
import { startImport } from '../../../../server/imports';

export const POST: APIRoute = ({ params }) => startImport(store(), getQueue(), params.id ?? '');
