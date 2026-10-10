import type { APIRoute } from 'astro';
import { getQueue } from '../../../../indexer/queue';
import { store } from '../../../../lib/store';
import { retryImport } from '../../../../server/imports';

export const POST: APIRoute = ({ params }) => retryImport(store(), getQueue(), params.id ?? '');
